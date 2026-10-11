/**
 * 批量处理引擎
 * 负责协调批量文件处理的全流程
 */

import { AIService } from './aiService'
import { webdavService } from './webdavService'
import { cloudCacheService } from './cloudCacheService'
import { metadataFormatter } from './metadataFormatter'
import type { ChapterData } from './epubProcessor'
import { matchesDefaultUnselectTitle } from './constants'
import { useConfigStore } from '../stores/configStore'
import type { BatchQueueItem, BatchProcessingConfig } from '../stores/batchQueueStore'
import type { SupportedLanguage } from './prompts/utils'
import type { BookCharts } from '@/charts'
import { clampConcurrency, mapPoolOrdered } from '../utils/async'
import { detectBookFormat, getMimeType } from '../utils/file'
import { prepareChapterInput } from '../utils/chapterInput'
import { RESULT_PREFIX, failedText, isFailedText, isUsableText } from '../utils/resultStatus'
import { createAbortError, isAbortError } from '../utils/runGuard'
import { usableOrEmpty } from '../utils/chapterResults'
import { logger } from '../lib/logger'

// 回调接口
export interface BatchProcessingCallbacks {
  onItemStart?: (item: BatchQueueItem) => void
  onItemProgress?: (itemId: string, progress: number, message: string) => void
  onItemComplete?: (item: BatchQueueItem, result: BatchProcessingResult) => void
  onItemError?: (item: BatchQueueItem, error: string) => void
  onItemSkip?: (item: BatchQueueItem, reason: string) => void
  onQueueComplete?: (results: BatchProcessingSummary) => void
  onError?: (error: Error) => void
}

/**
 * 单个文件的处理结果
 */
export interface BatchProcessingResult {
  success: boolean
  fileName: string
  outputPath?: string
  content?: string
  metadata?: {
    chapterCount: number
    processedChapters: number
    skippedChapters: number
    /** AI 调用失败的章节数（失败章节不写入云端） */
    failedChapters?: number
    costUSD: number
    costRMB: number
    startTime: string
    endTime: string
    isPartial?: boolean
  }
  error?: string
  /** 致命错误（如无法确认云端缓存状态）：调用方应停止整个队列而不是继续下一本 */
  fatal?: boolean
}


/**
 * 批量处理汇总结果
 */
export interface BatchProcessingSummary {
  totalFiles: number
  successCount: number
  failedCount: number
  skippedCount: number
  totalCostUSD: number
  totalCostRMB: number
  results: BatchProcessingResult[]
  duration: number // 毫秒
}

/** 批量侧暂只支持文字总结；导图模式待第 2 波统一 pipeline 后再支持 */
export const BATCH_UNSUPPORTED_MODE_ERROR =
  '批量处理暂不支持思维导图模式，请在设置中切换为「文字总结」后再开始批量处理'

export const BATCH_CACHE_STATUS_UNKNOWN_ERROR =
  '无法确认云端缓存状态（网络或鉴权异常），已中止以免覆盖已有结果，请检查 WebDAV 后重试'

const STOPPED_ERROR = '用户停止处理'

export function assertBatchModeSupported(mode: string): void {
  if (mode !== 'summary') {
    throw new Error(BATCH_UNSUPPORTED_MODE_ERROR)
  }
}

/** 批量默认选中章节（1-based），与单书一致：忽略类标题默认不选；全被忽略时回退全选 */
export function defaultBatchChapterSelection(
  chapters: ReadonlyArray<{ title: string }>
): number[] {
  const all = chapters.map((_, i) => i + 1)
  const picked = all.filter((n) => !matchesDefaultUnselectTitle(chapters[n - 1].title))
  return picked.length > 0 ? picked : all
}

interface ChapterRow {
  id: string
  title: string
  summary: string
}

/**
 * 批量处理引擎类
 */
export class BatchProcessingEngine {
  private isRunning = false
  private isPaused = false
  private shouldStop = false
  /** stop() 时 abort：进行中的 AI 请求与并发池立即停止 */
  private abortController: AbortController | null = null
  private callbacks: BatchProcessingCallbacks = {}
  private startTime: number = 0
  private static readonly DEFAULT_REQUEST_THROTTLE_MS = 100

  /**
   * 为单个文件创建 AI 服务（局部实例，避免文件级并行时 token 计数串号）
   */
  private createAIService(onTokenUsage?: (tokens: number) => void): AIService {
    const { aiConfig, aiServiceOptions } = useConfigStore.getState()

    return new AIService(
      {
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        apiUrl: aiConfig.apiUrl,
        model: aiConfig.model,
        temperature: aiConfig.temperature,
        proxyUrl: aiConfig.proxyUrl,
        proxyEnabled: aiConfig.proxyEnabled
      },
      () => useConfigStore.getState().promptConfig,
      {
        maxRetries: aiServiceOptions.maxRetries,
        baseRetryDelay: aiServiceOptions.baseRetryDelay,
        onTokenUsage,
      }
    )
  }

  /** 当前轮的取消信号；stop 后保持已取消，resetStopFlag 后换新 */
  private getSignal(): AbortSignal {
    if (!this.abortController || (this.abortController.signal.aborted && !this.shouldStop)) {
      this.abortController = new AbortController()
    }
    return this.abortController.signal
  }

  private throwIfStopped(signal: AbortSignal): void {
    if (this.shouldStop || signal.aborted) {
      throw createAbortError()
    }
  }

  /**
   * 设置回调函数
   */
  setCallbacks(callbacks: BatchProcessingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * 开始批量处理
   */
  async startProcessing(
    queueItems: BatchQueueItem[],
    config: BatchProcessingConfig
  ): Promise<BatchProcessingSummary> {
    if (this.isRunning) {
      throw new Error('批量处理已在运行中')
    }
    assertBatchModeSupported(useConfigStore.getState().processingOptions.processingMode)

    this.isRunning = true
    this.shouldStop = false
    this.isPaused = false
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    this.startTime = Date.now()

    logger.info(`[BatchEngine] 开始批量处理，共 ${queueItems.length} 个文件`)
    const settled: Array<BatchProcessingResult | null> = new Array(queueItems.length).fill(null)

    try {
      let cachedFileNames: Set<string> | undefined
      if (config.skipProcessed) {
        const listing = await cloudCacheService.fetchCacheFileNamesStatus()
        if (listing.status === 'unknown') {
          const err = new Error(`${BATCH_CACHE_STATUS_UNKNOWN_ERROR}（${listing.error}）`)
          this.callbacks.onError?.(err)
          throw err
        }
        cachedFileNames = listing.names
      }

      // 文件级并行（可配置，默认 3）；结果数组与完成回调按队列顺序提交
      const fileConcurrency = clampConcurrency(
        config.fileConcurrency ??
          useConfigStore.getState().processingOptions.chapterConcurrency ??
          3
      )

      try {
        await mapPoolOrdered(
          queueItems,
          async (item, index) => {
            while (this.isPaused && !this.shouldStop) {
              await this.sleep(1000)
            }
            this.throwIfStopped(signal)

            logger.info(
              `[BatchEngine] 处理文件 ${index + 1}/${queueItems.length}: ${item.fileName}`
            )

            const result = await this.processItem(item, config, cachedFileNames)
            if (result.fatal) {
              // 致命错误：停止出队，剩余文件不再处理
              this.stop()
            }
            return result
          },
          {
            concurrency: fileConcurrency,
            signal,
            onItemSettled: (result, index) => {
              settled[index] = result
            },
            onOrderedResult: (result, index) => {
              const item = queueItems[index]
              if (result.success) {
                this.callbacks.onItemComplete?.(item, result)
              } else {
                this.callbacks.onItemError?.(item, result.error || '处理失败')
              }
            },
          }
        )
      } catch (error) {
        // 用户停止：返回已完成部分的汇总；其它错误照常抛出
        if (!isAbortError(error) && !this.shouldStop) throw error
        logger.info('[BatchEngine] 用户停止处理')
      }
    } finally {
      this.isRunning = false
    }

    const results = settled.filter((r): r is BatchProcessingResult => r !== null)

    // 生成汇总
    const summary = this.generateSummary(results)
    this.callbacks.onQueueComplete?.(summary)

    logger.info('[BatchEngine] 批量处理完成', summary)
    return summary
  }

  /**
   * 暂停处理
   */
  pause(): void {
    this.isPaused = true
    logger.info('[BatchEngine] 处理已暂停')
  }

  /**
   * 继续处理
   */
  resume(): void {
    this.isPaused = false
    logger.info('[BatchEngine] 处理已继续')
  }

  /**
   * 停止处理：取消进行中的 AI 请求，并发池不再出队
   */
  stop(): void {
    this.shouldStop = true
    this.isPaused = false
    this.abortController?.abort()
    logger.info('[BatchEngine] 正在停止处理...')
  }

  resetStopFlag(): void {
    this.shouldStop = false
    this.abortController = new AbortController()
    logger.info('[BatchEngine] 停止标志已重置')
  }


  /**
   * 获取处理状态
   */
  getStatus(): { isRunning: boolean; isPaused: boolean } {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused
    }
  }

  /**
   * 处理单个文件（公开方法）
   */
  async processItem(
    item: BatchQueueItem,
    config: BatchProcessingConfig,
    cachedFileNames?: Set<string>
  ): Promise<BatchProcessingResult> {
    return this._processItem(item, config, cachedFileNames)
  }

  /**
   * skipProcessed 判定：列表命中直接跳过；未命中再用三态逐个确认，
   * 防止列目录失败（空集合）被当成「云端没有缓存」而重跑覆盖。
   */
  private async resolveCacheSkip(
    fileName: string,
    cachedFileNames?: Set<string>
  ): Promise<'skip' | 'process' | 'unknown'> {
    if (cachedFileNames && cloudCacheService.isCachedByFileName(fileName, cachedFileNames)) {
      return 'skip'
    }
    const status = await cloudCacheService.checkCacheStatus(fileName)
    if (status === 'exists') return 'skip'
    if (status === 'missing') return 'process'
    return 'unknown'
  }

  /**
   * 处理单个文件（内部方法）
   */
  private async _processItem(
    item: BatchQueueItem,
    config: BatchProcessingConfig,
    cachedFileNames?: Set<string>
  ): Promise<BatchProcessingResult> {

    const startTime = new Date().toISOString()
    const processingOptions = useConfigStore.getState().processingOptions
    const signal = this.getSignal()

    logger.info(`[BatchEngine] 开始处理文件: ${item.fileName}`)

    try {
      assertBatchModeSupported(processingOptions.processingMode)

      // 1. 检查是否需要跳过已处理的文件
      if (config.skipProcessed) {
        const decision = await this.resolveCacheSkip(item.fileName, cachedFileNames)
        if (decision === 'skip') {
          logger.info(`[BatchEngine] 文件已有缓存，跳过: ${item.fileName}`)
          this.callbacks.onItemSkip?.(item, '已有缓存')
          return {
            success: true,
            fileName: item.fileName,
            error: '已跳过（已有缓存）'
          }
        }
        if (decision === 'unknown') {
          return {
            success: false,
            fileName: item.fileName,
            error: BATCH_CACHE_STATUS_UNKNOWN_ERROR,
            fatal: true,
          }
        }
      }
      this.throwIfStopped(signal)

      // 2. 从 WebDAV 下载文件
      this.callbacks.onItemProgress?.(item.id, 5, '下载文件中...')
      const downloadResult = await this.downloadFileFromWebDAV(item.filePath)

      if (!downloadResult.success || !downloadResult.data) {
        throw new Error(downloadResult.error || '下载文件失败')
      }

      // 3. 解析章节
      this.callbacks.onItemProgress?.(item.id, 10, '解析章节中...')
      const chapters = await this.extractChapters(item.fileName, downloadResult.data)

      if (chapters.length === 0) {
        throw new Error('未能提取到任何章节')
      }

      logger.info(`[BatchEngine] 提取到 ${chapters.length} 个章节`)

      // 4. 处理选中的章节（结构化累积，禁止 ##/### 二次解析）
      const selectedChapters = item.selectedChapters || defaultBatchChapterSelection(chapters)
      let totalTokens = 0
      let aiService: AIService
      try {
        aiService = this.createAIService((n) => {
          totalTokens += n
        })
      } catch (error) {
        throw new Error(
          `AI 服务未初始化，请检查 AI 配置并重试：${error instanceof Error ? error.message : String(error)}`
        )
      }

      const bookTitle = item.fileName.replace(/\.(epub|pdf|txt|mobi|azw3)$/i, '')
      const outputLanguage = processingOptions.outputLanguage
      const requestThrottleMs = this.getRequestThrottleMs(config)

      const selectedList = chapters
        .map((chapter, i) => ({ chapter, originalIndex: i }))
        .filter(({ originalIndex }) => selectedChapters.includes(originalIndex + 1))

      const selectedChapterCount = selectedList.length
      const chapterConcurrency = clampConcurrency(
        config.chapterConcurrency ??
          processingOptions.chapterConcurrency ??
          3
      )
      let orderedDone = 0

      // 章节摘要（并行 + 按章节序号有序提交）；单章失败写占位，不拖垮整本
      const chapterSummaries = await mapPoolOrdered(
        selectedList,
        async ({ chapter }, idx): Promise<ChapterRow> => {
          this.throwIfStopped(signal)

          let summary: string
          try {
            summary = await this.processChapterSummary(
              aiService,
              chapter,
              processingOptions.bookType,
              outputLanguage,
              signal
            )
          } catch (error) {
            if (isAbortError(error) || this.shouldStop) throw error
            logger.error(`[BatchEngine] 章节失败: ${chapter.title}`, error)
            summary = failedText(RESULT_PREFIX.chapterFailed, error)
          }

          if (requestThrottleMs > 0) {
            await this.sleep(requestThrottleMs)
          }

          return {
            id: chapter.id || `chapter-${idx + 1}`,
            title: chapter.title,
            summary,
          }
        },
        {
          concurrency: chapterConcurrency,
          signal,
          onOrderedResult: (row, index) => {
            orderedDone = index + 1
            const progress =
              10 + Math.floor((orderedDone / Math.max(selectedList.length, 1)) * 55)
            this.callbacks.onItemProgress?.(
              item.id,
              progress,
              `生成章节摘要 (${orderedDone}/${selectedList.length}): ${row.title}`
            )
          },
        }
      )

      const skippedChapters = chapterSummaries.filter((r) =>
        AIService.isSkippedSummary(r.summary)
      ).length
      const failedChapters = chapterSummaries.filter((r) => isFailedText(r.summary)).length
      const usableRows = chapterSummaries.filter((r) => isUsableText(r.summary))

      // 无可用章节：不上传（否则 skipProcessed 会把空结果永久当成已处理）
      if (usableRows.length === 0) {
        throw new Error(
          `没有可用的章节摘要（失败 ${failedChapters} 章、跳过 ${skippedChapters} 章），未上传结果`
        )
      }

      const chapterObjects = usableRows.map((ch) => ({
        id: ch.id,
        title: ch.title,
        content: '',
        summary: ch.summary,
      }))

      // 关联分析
      this.throwIfStopped(signal)
      this.callbacks.onItemProgress?.(item.id, 75, '生成章节关联分析...')
      let connections = ''
      try {
        connections = await aiService.analyzeConnections(chapterObjects, outputLanguage, { signal })
      } catch (error) {
        if (isAbortError(error) || this.shouldStop) throw error
        logger.error('[BatchProcessingEngine] 章节关联分析生成失败:', error)
        connections = failedText(RESULT_PREFIX.connectionsFailed, error)
      }

      // 全书总结
      this.throwIfStopped(signal)
      this.callbacks.onItemProgress?.(item.id, 88, '生成全书总结...')
      let overallSummary = ''
      try {
        overallSummary = await aiService.generateOverallSummary(
          bookTitle,
          chapterObjects,
          usableOrEmpty(connections),
          outputLanguage,
          { signal }
        )
      } catch (error) {
        if (isAbortError(error) || this.shouldStop) throw error
        logger.error('[BatchProcessingEngine] 全书总结生成失败:', error)
        overallSummary = failedText(RESULT_PREFIX.overallFailed, error)
      }

      // 关键图表（仅全书总结成功）
      let charts: BookCharts | null = null
      if (isUsableText(overallSummary)) {
        this.throwIfStopped(signal)
        this.callbacks.onItemProgress?.(item.id, 93, '生成关键图表...')
        try {
          charts = await aiService.generateKeyCharts(
            bookTitle,
            chapterObjects,
            usableOrEmpty(connections),
            overallSummary,
            outputLanguage,
            { signal }
          )
        } catch (error) {
          if (isAbortError(error) || this.shouldStop) throw error
          logger.error('[BatchProcessingEngine] 关键图表生成失败:', error)
          charts = null
        }
      }

      // 5. 生成最终内容（只写可用部分；有失败即标记 isPartial）
      this.throwIfStopped(signal)
      this.callbacks.onItemProgress?.(item.id, 95, '保存结果...')

      const finalConnections = usableOrEmpty(connections)
      const finalOverall = usableOrEmpty(overallSummary)
      const endTime = new Date().toISOString()
      const originalCharCount = chapters.reduce((sum, ch) => sum + ch.content.length, 0)
      const processedCharCount =
        usableRows.reduce((sum, ch) => sum + ch.summary.length, 0) +
        finalConnections.length +
        finalOverall.length
      const isPartial =
        skippedChapters > 0 ||
        failedChapters > 0 ||
        isFailedText(connections) ||
        isFailedText(overallSummary)
      // 无分项 usage 时用总 token 作近似
      const totalInputTokens = Math.floor(totalTokens * 0.7)
      const totalOutputTokens = Math.max(0, totalTokens - totalInputTokens)

      const metadata = metadataFormatter.generate({
        fileName: item.fileName,
        bookTitle,
        model: useConfigStore.getState().aiConfig.model,
        chapterDetectionMode: processingOptions.chapterDetectionMode,
        selectedChapters,
        selectedChapterCount,
        chapterCount: chapters.length,
        originalCharCount,
        processedCharCount,
        skippedChapters,
        isPartial,
        aiResponseInfo: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens
        }
      })

      const bookData = {
        title: bookTitle,
        author: '',
        chapters: usableRows,
        overallSummary: finalOverall,
        connections: finalConnections,
        charts: charts as unknown as Record<string, unknown> | null,
      }

      const finalContent = metadataFormatter.formatUnified(
        bookData,
        metadata,
        processingOptions.chapterNamingMode
      )

      // 6. 上传到 WebDAV：MD + 同名关键图表 JSON
      const outputPath = cloudCacheService.getCacheFilePath(item.fileName)
      const uploadResult = await webdavService.uploadFile(outputPath, finalContent)

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || '上传结果失败')
      }

      if (charts) {
        const chartsUp = await cloudCacheService.uploadChartsJson(item.fileName, charts)
        if (!chartsUp.success) {
          logger.warn('[BatchProcessingEngine] 图表 JSON 上传失败:', chartsUp.error)
        }
      }

      this.callbacks.onItemProgress?.(item.id, 100, '处理完成')

      return {
        success: true,
        fileName: item.fileName,
        outputPath,
        content: finalContent,
        metadata: {
          chapterCount: chapters.length,
          processedChapters: usableRows.length,
          skippedChapters,
          failedChapters,
          costUSD: metadata.costUSD,
          costRMB: metadata.costRMB,
          startTime,
          endTime,
          isPartial
        }
      }

    } catch (error) {
      if (isAbortError(error) || this.shouldStop) {
        return { success: false, fileName: item.fileName, error: STOPPED_ERROR }
      }
      logger.error(`[BatchEngine] 处理文件失败: ${item.fileName}`, error)
      return {
        success: false,
        fileName: item.fileName,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  /**
   * 从 WebDAV 下载文件
   */
  private async downloadFileFromWebDAV(
    filePath: string
  ): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    try {
      const result = await webdavService.getFileContents(filePath, 'binary')
      return {
        success: result.success,
        data: result.data as ArrayBuffer | undefined,
        error: result.error
      }

    } catch (error) {
      logger.error(`[BatchEngine] 下载文件失败: ${filePath}`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载文件失败'
      }
    }
  }

  /**
   * 提取章节（解析器按格式动态加载，避免 pdfjs/epubjs 进首屏；用完即释放）
   */
  private async extractChapters(
    fileName: string,
    fileData: ArrayBuffer
  ): Promise<ChapterData[]> {
    const processingOptions = useConfigStore.getState().processingOptions
    const file = new File([fileData], fileName, { type: getMimeType(fileName) })
    const format = detectBookFormat(file)
    const args = [
      processingOptions.useSmartDetection,
      processingOptions.skipNonEssentialChapters,
      processingOptions.maxSubChapterDepth,
      processingOptions.chapterNamingMode,
      processingOptions.chapterDetectionMode,
      processingOptions.epubTocDepth,
    ] as const

    try {
      if (format === 'epub') {
        const { EpubProcessor } = await import('./epubProcessor')
        const processor = new EpubProcessor()
        try {
          const bookData = await processor.extractBookData(file, ...args)
          return bookData.chapters
        } finally {
          await processor.destroy()
        }
      }
      if (format === 'pdf') {
        const { PdfProcessor } = await import('./pdfProcessor')
        const processor = new PdfProcessor()
        try {
          return await processor.extractChapters(file, ...args)
        } finally {
          await processor.destroy()
        }
      }
      // 对于不支持的格式，尝试作为纯文本处理
      const content = new TextDecoder('utf-8').decode(fileData)
      return [{ id: '1', title: '全文', content }]
    } catch (error) {
      logger.error('[BatchEngine] 提取章节失败:', error)
      throw error
    }
  }

  /**
   * 处理单个章节摘要（与单书共用 prepareChapterInput 截断规则）
   */
  private async processChapterSummary(
    aiService: AIService,
    chapter: ChapterData,
    bookType: 'fiction' | 'non-fiction',
    outputLanguage: SupportedLanguage,
    signal?: AbortSignal
  ): Promise<string> {
    return await aiService.summarizeChapter(
      chapter.title,
      prepareChapterInput(chapter.content),
      bookType,
      outputLanguage,
      undefined,
      { signal }
    )
  }

  /**
   * 获取请求节流间隔（毫秒）
   */
  private getRequestThrottleMs(config: BatchProcessingConfig): number {
    if (typeof config.requestThrottleMs !== 'number' || Number.isNaN(config.requestThrottleMs)) {
      return BatchProcessingEngine.DEFAULT_REQUEST_THROTTLE_MS
    }

    return Math.max(0, config.requestThrottleMs)
  }

  /**
   * 生成处理汇总
   */
  private generateSummary(results: BatchProcessingResult[]): BatchProcessingSummary {
    const successResults = results.filter(r => r.success && !r.error?.includes('已跳过'))
    const skippedResults = results.filter(r => r.error?.includes('已跳过'))
    const failedResults = results.filter(r => !r.success && !r.error?.includes('已跳过'))

    let totalCostUSD = 0
    let totalCostRMB = 0

    for (const result of successResults) {
      if (result.metadata) {
        totalCostUSD += result.metadata.costUSD
        totalCostRMB += result.metadata.costRMB
      }
    }

    return {
      totalFiles: results.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      skippedCount: skippedResults.length,
      totalCostUSD,
      totalCostRMB,
      results,
      duration: Date.now() - this.startTime
    }
  }

  /**
   * 等待指定时间
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// 导出单例
export const batchProcessingEngine = new BatchProcessingEngine()
