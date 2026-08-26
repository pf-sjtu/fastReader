/**
 * 批量处理引擎
 * 负责协调批量文件处理的全流程
 */

import { AIService } from './aiService'
import { webdavService } from './webdavService'
import { cloudCacheService } from './cloudCacheService'
import { metadataFormatter } from './metadataFormatter'
import { EpubProcessor } from './epubProcessor'
import { PdfProcessor } from './pdfProcessor'
import type { ChapterData } from './epubProcessor'
import { useConfigStore } from '../stores/configStore'
import type { BatchQueueItem, BatchProcessingConfig } from '../stores/batchQueueStore'
import type { SupportedLanguage } from './prompts/utils'
import { clampConcurrency, mapPoolOrdered } from '../utils/async'
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
    costUSD: number
    costRMB: number
    startTime: string
    endTime: string
    isPartial?: boolean
  }
  error?: string
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

/**
 * 批量处理引擎类
 */
export class BatchProcessingEngine {
  private isRunning = false
  private isPaused = false
  private shouldStop = false
  private aiService: AIService | null = null
  private callbacks: BatchProcessingCallbacks = {}
  private startTime: number = 0
  private static readonly DEFAULT_REQUEST_THROTTLE_MS = 100


  constructor() {
    // 初始化 AI 服务
    this.initializeAIService()
  }

  /**
   * 初始化 AI 服务
   */
  private initializeAIService(onTokenUsage?: (tokens: number) => void): void {
    const aiConfig = useConfigStore.getState().aiConfig
    const aiServiceOptions = useConfigStore.getState().aiServiceOptions

    this.aiService = new AIService(
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

    this.isRunning = true
    this.shouldStop = false
    this.isPaused = false
    this.startTime = Date.now()

    logger.info(`[BatchEngine] 开始批量处理，共 ${queueItems.length} 个文件`)
    const results: BatchProcessingResult[] = []

    try {
      // 重新初始化 AI 服务（确保使用最新配置）
      this.initializeAIService()
      const cachedFileNames = config.skipProcessed
        ? await cloudCacheService.fetchCacheFileNames()
        : undefined

      // 文件级并行（可配置，默认 3）；结果数组与完成回调按队列顺序提交
      const fileConcurrency = clampConcurrency(
        config.fileConcurrency ??
          useConfigStore.getState().processingOptions.chapterConcurrency ??
          3
      )

      const processedResults = await mapPoolOrdered(
        queueItems,
        async (item, index) => {
          if (this.shouldStop) {
            logger.info('[BatchEngine] 用户停止处理')
            return null
          }

          while (this.isPaused && !this.shouldStop) {
            await this.sleep(1000)
          }

          if (this.shouldStop) {
            return null
          }

          logger.info(
            `[BatchEngine] 处理文件 ${index + 1}/${queueItems.length}: ${item.fileName}`
          )

          try {
            return await this.processItem(item, config, cachedFileNames)
          } catch (error) {
            logger.error(`[BatchEngine] 条目未预期失败: ${item.fileName}`, error)
            return {
              success: false,
              fileName: item.fileName,
              error: error instanceof Error ? error.message : '未知错误',
            } as BatchProcessingResult
          }
        },
        {
          concurrency: fileConcurrency,
          onOrderedResult: (result, index) => {
            if (!result) return
            const item = queueItems[index]
            if (result.success) {
              this.callbacks.onItemComplete?.(item, result)
            } else {
              this.callbacks.onItemError?.(item, result.error || '处理失败')
            }
          },
        }
      )
      results.push(
        ...processedResults.filter((r): r is BatchProcessingResult => r !== null)
      )
    } finally {
      this.isRunning = false
    }


    // 生成汇总
    const summary = this.generateSummary(results)
    this.callbacks.onQueueComplete?.(summary)

    console.log('[BatchEngine] 批量处理完成', summary)
    return summary
  }

  /**
   * 暂停处理
   */
  pause(): void {
    this.isPaused = true
    console.log('[BatchEngine] 处理已暂停')
  }

  /**
   * 继续处理
   */
  resume(): void {
    this.isPaused = false
    console.log('[BatchEngine] 处理已继续')
  }

  /**
   * 停止处理
   */
  stop(): void {
    this.shouldStop = true
    this.isPaused = false
    console.log('[BatchEngine] 正在停止处理...')
  }

  resetStopFlag(): void {
    this.shouldStop = false
    console.log('[BatchEngine] 停止标志已重置')
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
   * 处理单个文件（内部方法）
   */
  private async _processItem(
    item: BatchQueueItem,
    config: BatchProcessingConfig,
    cachedFileNames?: Set<string>
  ): Promise<BatchProcessingResult> {

    const startTime = new Date().toISOString()
    const processingOptions = useConfigStore.getState().processingOptions

    console.log(`[BatchEngine] 开始处理文件: ${item.fileName}`)

    try {
      // 1. 检查是否需要跳过已处理的文件
      if (config.skipProcessed) {
        const cachedFiles = cachedFileNames
          ?? await cloudCacheService.fetchCacheFileNames()
        if (cloudCacheService.isCachedByFileName(item.fileName, cachedFiles)) {
          console.log(`[BatchEngine] 文件已有缓存，跳过: ${item.fileName}`)
          this.callbacks.onItemSkip?.(item, '已有缓存')
          return {
            success: true,
            fileName: item.fileName,
            error: '已跳过（已有缓存）'
          }
        }
      }


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

      console.log(`[BatchEngine] 提取到 ${chapters.length} 个章节`)

      // 4. 处理选中的章节（结构化累积，禁止 ##/### 二次解析）
      const selectedChapters = item.selectedChapters || chapters.map((_, i) => i + 1)
      let totalTokens = 0
      this.initializeAIService((n) => {
        totalTokens += n
      })

      let skippedChapters = 0
      let selectedChapterCount = 0
      const chapterSummaries: Array<{ id: string; title: string; summary: string }> = []
      let connections = ''
      let overallSummary = ''

      const bookTitle = item.fileName.replace(/\.(epub|pdf|txt|mobi|azw3)$/i, '')
      const mode = processingOptions.processingMode
      const requestThrottleMs = this.getRequestThrottleMs(config)

      // 章节摘要：summary / combined-mindmap（并行 + 按章节序号有序提交）
      if (mode === 'summary' || mode === 'combined-mindmap') {
        const selectedList = chapters
          .map((chapter, i) => ({ chapter, originalIndex: i }))
          .filter(({ originalIndex }) => selectedChapters.includes(originalIndex + 1))

        selectedChapterCount = selectedList.length
        const chapterConcurrency = clampConcurrency(
          config.chapterConcurrency ??
            processingOptions.chapterConcurrency ??
            3
        )
        let orderedDone = 0

        const orderedSummaries = await mapPoolOrdered(
          selectedList,
          async ({ chapter }, idx) => {
            if (this.shouldStop) {
              throw new Error('用户停止处理')
            }

            const summary = await this.processChapterSummary(
              chapter,
              processingOptions.bookType,
              processingOptions.outputLanguage
            )

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
            onOrderedResult: (row, index) => {
              orderedDone = index + 1
              if (AIService.isSkippedSummary(row.summary)) {
                skippedChapters++
              }
              chapterSummaries.push(row)
              const progress =
                10 +
                Math.floor(
                  (orderedDone / Math.max(selectedList.length, 1)) * 55
                )
              this.callbacks.onItemProgress?.(
                item.id,
                progress,
                `生成章节摘要 (${orderedDone}/${selectedList.length}): ${row.title}`
              )
            },
          }
        )

        // 若 onOrderedResult 未覆盖（理论不会），保证数组完整有序
        if (chapterSummaries.length !== orderedSummaries.length) {
          chapterSummaries.length = 0
          chapterSummaries.push(...orderedSummaries)
        }
      }

      // mindmap 模式：批量侧仍用关联分析作为可读结果（完整导图 JSON 不适合统一 md 缓存）
      // summary / combined：关联分析只跑一次
      const needConnections =
        mode === 'summary' || mode === 'combined-mindmap' || mode === 'mindmap'

      if (needConnections) {
        if (this.shouldStop) {
          throw new Error('用户停止处理')
        }

        this.callbacks.onItemProgress?.(item.id, 75, '生成章节关联分析...')

        const chapterObjects =
          chapterSummaries.length > 0
            ? chapterSummaries.map((ch) => ({
                id: ch.id,
                title: ch.title,
                content: '',
                summary: ch.summary,
              }))
            : chapters
                .filter((_, i) => selectedChapters.includes(i + 1))
                .map((ch, idx) => ({
                  id: ch.id || String(idx + 1),
                  title: ch.title,
                  content: ch.content,
                  summary: '',
                }))

        if (chapterObjects.length > 0) {
          try {
            const aiService = this.getAIServiceOrThrow('章节关联分析')
            connections = await aiService.analyzeConnections(
              chapterObjects,
              processingOptions.outputLanguage
            )
          } catch (error) {
            console.error('[BatchProcessingEngine] 章节关联分析生成失败:', error)
            connections = `【关联分析失败】${error instanceof Error ? error.message : '未知错误'}`
          }
        }
      }

      // 全书总结
      if (mode === 'summary' || mode === 'combined-mindmap') {
        if (this.shouldStop) {
          throw new Error('用户停止处理')
        }

        this.callbacks.onItemProgress?.(item.id, 88, '生成全书总结...')

        const chapterObjects = chapterSummaries.map((ch) => ({
          id: ch.id,
          title: ch.title,
          content: '',
          summary: ch.summary,
        }))

        if (chapterObjects.length > 0) {
          try {
            const aiService = this.getAIServiceOrThrow('全书总结')
            overallSummary = await aiService.generateOverallSummary(
              bookTitle,
              chapterObjects,
              connections,
              processingOptions.outputLanguage
            )
          } catch (error) {
            console.error('[BatchProcessingEngine] 全书总结生成失败:', error)
            overallSummary = `【全书总结失败】${error instanceof Error ? error.message : '未知错误'}`
          }
        }
      }

      // 关键图表（仅 summary 且全书总结成功）
      let charts: import('@/charts').BookCharts | null = null
      if (
        mode === 'summary' &&
        overallSummary &&
        !overallSummary.startsWith('【全书总结失败】')
      ) {
        if (this.shouldStop) {
          throw new Error('用户停止处理')
        }
        this.callbacks.onItemProgress?.(item.id, 93, '生成关键图表...')
        try {
          const aiService = this.getAIServiceOrThrow('关键图表')
          const chapterObjects = chapterSummaries.map((ch) => ({
            id: ch.id,
            title: ch.title,
            content: '',
            summary: ch.summary,
          }))
          charts = await aiService.generateKeyCharts(
            bookTitle,
            chapterObjects,
            connections.startsWith('【关联分析失败】') ? '' : connections,
            overallSummary,
            processingOptions.outputLanguage
          )
        } catch (error) {
          console.error('[BatchProcessingEngine] 关键图表生成失败:', error)
          charts = null
        }
      }

      // 5. 生成最终内容
      this.callbacks.onItemProgress?.(item.id, 95, '保存结果...')

      const endTime = new Date().toISOString()
      const originalCharCount = chapters.reduce((sum, ch) => sum + ch.content.length, 0)
      const processedCharCount =
        chapterSummaries.reduce((sum, ch) => sum + ch.summary.length, 0) +
        connections.length +
        overallSummary.length
      const isPartial = skippedChapters > 0
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
        chapters: chapterSummaries,
        overallSummary,
        connections,
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
          console.warn('[BatchProcessingEngine] 图表 JSON 上传失败:', chartsUp.error)
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
          processedChapters: Math.max(selectedChapterCount - skippedChapters, 0),
          skippedChapters,
          costUSD: metadata.costUSD,
          costRMB: metadata.costRMB,
          startTime,
          endTime,
          isPartial
        }
      }

    } catch (error) {
      console.error(`[BatchEngine] 处理文件失败: ${item.fileName}`, error)
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
   * 提取章节
   */
  private async extractChapters(
    fileName: string,
    fileData: ArrayBuffer
  ): Promise<ChapterData[]> {
    const processingOptions = useConfigStore.getState().processingOptions

    try {
      if (fileName.endsWith('.epub')) {
        const processor = new EpubProcessor()

        // 将 ArrayBuffer 转换为 Blob 再转换为 File
        const blob = new Blob([fileData], { type: 'application/epub+zip' })
        const file = new File([blob], fileName, { type: 'application/epub+zip' })

        const bookData = await processor.extractBookData(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )

        return bookData.chapters
      } else if (fileName.endsWith('.pdf')) {
        const processor = new PdfProcessor()

        const blob = new Blob([fileData], { type: 'application/pdf' })
        const file = new File([blob], fileName, { type: 'application/pdf' })

        return await processor.extractChapters(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
      } else {
        // 对于不支持的格式，尝试作为纯文本处理
        const decoder = new TextDecoder('utf-8')
        const content = decoder.decode(fileData)
        return [{
          id: '1',
          title: '全文',
          content: content
        }]
      }
    } catch (error) {
      console.error('[BatchEngine] 提取章节失败:', error)
      throw error
    }
  }

  /**
   * 处理单个章节摘要
   */
  private async processChapterSummary(
    chapter: ChapterData,
    bookType: 'fiction' | 'non-fiction',
    outputLanguage: SupportedLanguage
  ): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI 服务未初始化')
    }

    // 如果章节内容过长，截取部分内容
    const maxContentLength = 50000
    const content = chapter.content.length > maxContentLength
      ? chapter.content.substring(0, maxContentLength) + '...'
      : chapter.content

    return await this.aiService.summarizeChapter(
      chapter.title,
      content,
      bookType,
      outputLanguage
    )
  }

  /**
   * 获取 AI 服务实例（带可诊断错误）
   */
  private getAIServiceOrThrow(context: string): AIService {
    if (!this.aiService) {
      throw new Error(`AI 服务未初始化，无法执行${context}，请检查 AI 配置并重试`)
    }

    return this.aiService
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
