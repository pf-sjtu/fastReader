/**
 * 批量处理引擎：队列调度、下载、解析；单本处理委托 runBookPipeline（与单书同一流程）
 */

import { AIService } from './ai'
import { cloudCacheService } from './cloudCacheService'
import type { ChapterData } from './epubProcessor'
import { matchesDefaultUnselectTitle } from './constants'
import { useConfigStore } from '../stores/configStore'
import type { BatchQueueItem, BatchProcessingConfig } from '../stores/batchQueueStore'
import type { BatchProcessingCallbacks, BatchProcessingResult, BatchProcessingSummary } from '../types/batch'
import { clampConcurrency, mapPoolOrdered } from '../utils/async'
import { isAbortError } from '../utils/runGuard'
import { logger } from '../lib/logger'
import { runBookPipeline } from './pipeline/bookPipeline'
import {
  batchMsg as msg,
  buildBatchMetadata,
  downloadBookData,
  phaseMessage,
  createBatchCache,
  extractChaptersFromData,
  resolveBatchSkip,
  saveBatchMindMaps,
  saveBatchSummary,
} from './pipeline/batchItem'

export type {
  BatchProcessingCallbacks,
  BatchProcessingResult,
  BatchProcessingSummary,
} from '../types/batch'

const SUPPORTED_MODES: readonly string[] = ['summary', 'mindmap', 'combined-mindmap']

export const BATCH_UNSUPPORTED_MODE_ERROR = '批量处理不支持该处理模式'

export const BATCH_CACHE_STATUS_UNKNOWN_ERROR =
  '无法确认云端缓存状态（网络或鉴权异常），已中止以免覆盖已有结果，请检查 WebDAV 后重试'

const STOPPED_ERROR = '用户停止处理'
const SKIPPED_ERROR = '已跳过（已有缓存）'

export function assertBatchModeSupported(mode: string): void {
  if (!SUPPORTED_MODES.includes(mode)) {
    throw new Error(`${BATCH_UNSUPPORTED_MODE_ERROR}: ${mode}`)
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

export class BatchProcessingEngine {
  private isRunning = false
  private isPaused = false
  private shouldStop = false
  /** stop() 时 abort：进行中的 AI 请求与并发池立即停止 */
  private abortController: AbortController | null = null
  private callbacks: BatchProcessingCallbacks = {}
  private startTime: number = 0
  private static readonly DEFAULT_REQUEST_THROTTLE_MS = 100

  /** 为单个文件创建 AI 服务（局部实例，避免文件级并行时 token 计数串号） */
  private createAIService(onTokenUsage?: (tokens: number) => void): AIService {
    const { aiConfig, aiServiceOptions } = useConfigStore.getState()
    const { provider, apiKey, apiUrl, model, temperature, proxyUrl, proxyEnabled } = aiConfig
    return new AIService(
      { provider, apiKey, apiUrl, model, temperature, proxyUrl, proxyEnabled },
      () => useConfigStore.getState().promptConfig,
      { maxRetries: aiServiceOptions.maxRetries, baseRetryDelay: aiServiceOptions.baseRetryDelay, onTokenUsage }
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
      throw new DOMException('Aborted', 'AbortError')
    }
  }

  setCallbacks(callbacks: BatchProcessingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  async startProcessing(
    queueItems: BatchQueueItem[],
    config: BatchProcessingConfig
  ): Promise<BatchProcessingSummary> {
    if (this.isRunning) {
      throw new Error('批量处理已在运行中')
    }
    const mode = useConfigStore.getState().processingOptions.processingMode
    assertBatchModeSupported(mode)

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
      // 导图模式用逐本 manifest 判定，不需要列 MD 目录
      if (config.skipProcessed && mode === 'summary') {
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
        config.fileConcurrency ?? useConfigStore.getState().processingOptions.chapterConcurrency ?? 3
      )

      try {
        await mapPoolOrdered(
          queueItems,
          async (item, index) => {
            while (this.isPaused && !this.shouldStop) {
              await this.sleep(1000)
            }
            this.throwIfStopped(signal)
            logger.info(`[BatchEngine] 处理文件 ${index + 1}/${queueItems.length}: ${item.fileName}`)
            const result = await this.processItem(item, config, cachedFileNames)
            // 致命错误：停止出队，剩余文件不再处理
            if (result.fatal) this.stop()
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
              if (result.success) this.callbacks.onItemComplete?.(item, result)
              else this.callbacks.onItemError?.(item, result.error || '处理失败')
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
    const summary = this.generateSummary(results)
    this.callbacks.onQueueComplete?.(summary)
    logger.info('[BatchEngine] 批量处理完成', summary)
    return summary
  }

  pause(): void {
    this.isPaused = true
    logger.info('[BatchEngine] 处理已暂停')
  }

  resume(): void {
    this.isPaused = false
    logger.info('[BatchEngine] 处理已继续')
  }

  /** 停止处理：取消进行中的 AI 请求，并发池不再出队 */
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

  getStatus(): { isRunning: boolean; isPaused: boolean } {
    return { isRunning: this.isRunning, isPaused: this.isPaused }
  }

  /** 处理单个文件：跳过判定 → 下载 → 解析 → runBookPipeline → 上云 */
  async processItem(
    item: BatchQueueItem,
    config: BatchProcessingConfig,
    cachedFileNames?: Set<string>
  ): Promise<BatchProcessingResult> {
    const startTime = new Date().toISOString()
    const processingOptions = useConfigStore.getState().processingOptions
    const mode = processingOptions.processingMode
    const signal = this.getSignal()
    const progress = (p: number, text: string) => this.callbacks.onItemProgress?.(item.id, p, text)

    logger.info(`[BatchEngine] 开始处理文件: ${item.fileName}`)

    try {
      assertBatchModeSupported(mode)

      if (config.skipProcessed) {
        const decision = await resolveBatchSkip(item.fileName, mode, cachedFileNames)
        if (decision === 'skip') {
          logger.info(`[BatchEngine] 文件已有缓存，跳过: ${item.fileName}`)
          this.callbacks.onItemSkip?.(item, '已有缓存')
          return { success: true, skipped: true, fileName: item.fileName, error: SKIPPED_ERROR }
        }
        if (decision === 'unknown') {
          return { success: false, fileName: item.fileName, error: BATCH_CACHE_STATUS_UNKNOWN_ERROR, fatal: true }
        }
      }
      this.throwIfStopped(signal)

      progress(5, msg('batch.progress.downloading', '下载文件中...'))
      const download = await downloadBookData(item.filePath)
      if (!download.success || !download.data) {
        throw new Error(download.error || '下载文件失败')
      }

      progress(10, msg('batch.progress.extracting', '解析章节中...'))
      const chapters = await this.extractChapters(item.fileName, download.data)
      if (chapters.length === 0) throw new Error('未能提取到任何章节')
      logger.info(`[BatchEngine] 提取到 ${chapters.length} 个章节`)

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
      const throttleMs = this.getRequestThrottleMs(config)
      const selected = chapters
        .map((chapter, i) => ({ chapter, n: i + 1 }))
        .filter(({ n }) => selectedChapters.includes(n))
        .map(({ chapter, n }) => ({ id: chapter.id || `chapter-${n}`, title: chapter.title, content: chapter.content }))
      const { aiConfig, promptConfig } = useConfigStore.getState()
      const cache = await createBatchCache(download.data, {
        modelId: `${aiConfig.provider}:${aiConfig.model}`,
        outputLanguage: processingOptions.outputLanguage,
        bookType: processingOptions.bookType,
        promptConfig,
      })

      const result = await runBookPipeline({
        chapters: selected,
        mode,
        ai: aiService,
        bookTitle,
        bookType: processingOptions.bookType,
        outputLanguage: processingOptions.outputLanguage,
        concurrency: clampConcurrency(config.chapterConcurrency ?? processingOptions.chapterConcurrency ?? 3),
        signal,
        cache,
        afterChapterAI: throttleMs > 0 ? () => this.sleep(throttleMs) : undefined,
        onChapter: (ch, index, info) =>
          progress(
            10 + Math.floor(info.progress * 0.8),
            msg('batch.progress.chapter', '处理章节 ({{done}}/{{total}}): {{title}}', {
              done: index + 1,
              total: selected.length,
              title: ch.title,
            })
          ),
        onPhase: (phase, p) => {
          const text = phaseMessage(phase)
          if (text) progress(10 + Math.floor(p * 0.8), text)
        },
      })
      this.throwIfStopped(signal)
      progress(95, msg('batch.progress.saving', '保存结果...'))

      const { stats } = result
      if (stats.usable === 0) {
        throw new Error(
          `没有可用的章节${mode === 'summary' ? '摘要' : '导图'}（失败 ${stats.failed} 章、跳过 ${stats.skipped} 章），未上传结果`
        )
      }

      const metadata = buildBatchMetadata({
        fileName: item.fileName,
        bookTitle,
        model: aiConfig.model,
        chapterDetectionMode: processingOptions.chapterDetectionMode,
        selectedChapters,
        chapters,
        result,
        totalTokens,
      })

      const saved: { outputPath: string; content?: string } =
        mode === 'summary'
          ? await saveBatchSummary(item.fileName, bookTitle, result, metadata, processingOptions.chapterNamingMode)
          : await saveBatchMindMaps(item.fileName, bookTitle, mode, result, { chapterCount: chapters.length, model: aiConfig.model })

      progress(100, msg('batch.progress.done', '处理完成'))
      return {
        success: true,
        fileName: item.fileName,
        outputPath: saved.outputPath,
        content: saved.content,
        metadata: {
          chapterCount: chapters.length,
          processedChapters: stats.usable,
          skippedChapters: stats.skipped,
          failedChapters: stats.failed,
          cachedChapters: stats.cached,
          costUSD: metadata.costUSD ?? 0,
          costRMB: metadata.costRMB ?? 0,
          startTime,
          endTime: new Date().toISOString(),
          isPartial: result.isPartial,
        },
      }
    } catch (error) {
      if (isAbortError(error) || this.shouldStop) {
        return { success: false, fileName: item.fileName, error: STOPPED_ERROR }
      }
      logger.error(`[BatchEngine] 处理文件失败: ${item.fileName}`, error)
      return { success: false, fileName: item.fileName, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /** 提取章节（解析器按格式动态加载，用完即释放） */
  private extractChapters(fileName: string, fileData: ArrayBuffer): Promise<ChapterData[]> {
    return extractChaptersFromData(fileName, fileData, useConfigStore.getState().processingOptions)
  }

  private getRequestThrottleMs(config: BatchProcessingConfig): number {
    if (typeof config.requestThrottleMs !== 'number' || Number.isNaN(config.requestThrottleMs)) {
      return BatchProcessingEngine.DEFAULT_REQUEST_THROTTLE_MS
    }
    return Math.max(0, config.requestThrottleMs)
  }

  private generateSummary(results: BatchProcessingResult[]): BatchProcessingSummary {
    const skippedResults = results.filter((r) => r.skipped)
    const successResults = results.filter((r) => r.success && !r.skipped)
    const failedResults = results.filter((r) => !r.success)
    let totalCostUSD = 0
    let totalCostRMB = 0
    for (const result of successResults) {
      if (result.metadata) {
        totalCostUSD += result.metadata.costUSD ?? 0
        totalCostRMB += result.metadata.costRMB ?? 0
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
      duration: Date.now() - this.startTime,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const batchProcessingEngine = new BatchProcessingEngine()
