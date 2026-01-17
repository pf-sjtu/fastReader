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
    costUSD: number
    costRMB: number
    startTime: string
    endTime: string
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


  constructor() {
    // 初始化 AI 服务
    this.initializeAIService()
  }

  /**
   * 初始化 AI 服务
   */
  private initializeAIService(): void {
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
      undefined,
      {
        maxRetries: aiServiceOptions.maxRetries,
        baseRetryDelay: aiServiceOptions.baseRetryDelay
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

    console.log(`[BatchEngine] 开始批量处理，共 ${queueItems.length} 个文件`)
    const results: BatchProcessingResult[] = []

    try {
      // 重新初始化 AI 服务（确保使用最新配置）
      this.initializeAIService()
      const cachedFileNames = config.skipProcessed
        ? await cloudCacheService.fetchCacheFileNames()
        : undefined

      for (let i = 0; i < queueItems.length; i++) {
        if (this.shouldStop) {
          console.log('[BatchEngine] 用户停止处理')
          break
        }


        const item = queueItems[i]

        // 检查是否暂停
        while (this.isPaused && !this.shouldStop) {
          await this.sleep(1000)
        }

        if (this.shouldStop) {
          break
        }

        console.log(`[BatchEngine] 处理文件 ${i + 1}/${queueItems.length}: ${item.fileName}`)

        try {
          const result = await this.processItem(item, config, cachedFileNames)

          results.push(result)

          if (result.success) {
            this.callbacks.onItemComplete?.(item, result)
          } else {
            this.callbacks.onItemError?.(item, result.error || '处理失败')
          }
        } catch (error) {
          const errorResult: BatchProcessingResult = {
            success: false,
            fileName: item.fileName,
            error: error instanceof Error ? error.message : '未知错误'
          }
          results.push(errorResult)
          this.callbacks.onItemError?.(item, errorResult.error || '处理失败')
        }
      }
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

      // 4. 处理选中的章节
      const selectedChapters = item.selectedChapters || chapters.map((_, i) => i + 1)
      const results: string[] = []
      const totalInputTokens = 0
      const totalOutputTokens = 0

      // 生成书名（从文件名提取）
      const bookTitle = item.fileName.replace(/\.(epub|pdf|txt|mobi|azw3)$/i, '')

      // 根据处理模式生成内容
      if (processingOptions.processingMode === 'summary' || processingOptions.processingMode === 'combined-mindmap') {
        // 生成章节摘要
        for (let i = 0; i < chapters.length; i++) {
          if (this.shouldStop) {
            throw new Error('用户停止处理')
          }

          const chapter = chapters[i]
          if (!selectedChapters.includes(i + 1)) {
            continue
          }

          const progress = 10 + Math.floor((i / chapters.length) * 60)
          this.callbacks.onItemProgress?.(
            item.id,
            progress,
            `生成章节摘要 (${i + 1}/${chapters.length}): ${chapter.title}`
          )

          const summary = await this.processChapterSummary(
            chapter,
            processingOptions.bookType,
            processingOptions.outputLanguage
          )
          results.push(`## ${chapter.title}\n\n${summary}`)

          // 模拟 token 统计（实际由 AIService 内部记录）
          await this.sleep(100) // 避免请求过快
        }
      }

      // 生成关联分析
      if (processingOptions.processingMode === 'combined-mindmap' || processingOptions.processingMode === 'mindmap') {
        this.callbacks.onItemProgress?.(item.id, 75, '生成章节关联分析...')

        const chapterObjects = chapters
          .filter((_, i) => selectedChapters.includes(i + 1))
          .map((ch, idx) => ({
            id: String(idx + 1),
            title: ch.title,
            content: ch.content
          }))

        if (chapterObjects.length > 0) {
          const connections = await this.aiService!.analyzeConnections(
            chapterObjects,
            processingOptions.outputLanguage
          )

          if (processingOptions.processingMode === 'combined-mindmap') {
            results.push(`## 章节关联分析\n\n${connections}`)
          }
        }
      }

      // 生成全书总结
      if (processingOptions.processingMode === 'summary' || processingOptions.processingMode === 'combined-mindmap') {
        this.callbacks.onItemProgress?.(item.id, 85, '生成全书总结...')

        const chapterObjects = chapters
          .filter((_, i) => selectedChapters.includes(i + 1))
          .map((ch, idx) => ({
            id: String(idx + 1),
            title: ch.title,
            content: ch.content,
            summary: results[idx]?.replace(/^## .*\n\n/, '') || ''
          }))

        if (chapterObjects.length > 0) {
          const connections = await this.aiService!.analyzeConnections(
            chapterObjects,
            processingOptions.outputLanguage
          )
          const overallSummary = await this.aiService!.generateOverallSummary(
            bookTitle,
            chapterObjects,
            connections,
            processingOptions.outputLanguage
          )

          results.push(`## 全书总结\n\n${overallSummary}`)
        }
      }

      // 5. 生成最终内容
      this.callbacks.onItemProgress?.(item.id, 95, '保存结果...')

      const endTime = new Date().toISOString()
      const originalCharCount = chapters.reduce((sum, ch) => sum + ch.content.length, 0)
      const processedCharCount = results.join('\n\n').length

      // 生成元数据
      const metadata = metadataFormatter.generate({
        fileName: item.fileName,
        bookTitle,
        model: useConfigStore.getState().aiConfig.model,
        chapterDetectionMode: processingOptions.chapterDetectionMode,
        selectedChapters,
        chapterCount: chapters.length,
        originalCharCount,
        processedCharCount,
        aiResponseInfo: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens
        }
      })

      // 添加元数据到内容
      const finalContent = metadataFormatter.addToContent(
        `# ${bookTitle}\n\n` + results.join('\n\n---\n\n'),
        metadata
      )

      // 6. 上传到 WebDAV
      const outputPath = cloudCacheService.getCacheFilePath(item.fileName)
      const uploadResult = await webdavService.uploadFile(outputPath, finalContent)

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || '上传结果失败')
      }

      this.callbacks.onItemProgress?.(item.id, 100, '处理完成')

      return {
        success: true,
        fileName: item.fileName,
        outputPath,
        content: finalContent,
        metadata: {
          chapterCount: chapters.length,
          processedChapters: selectedChapters.length,
          costUSD: metadata.costUSD,
          costRMB: metadata.costRMB,
          startTime,
          endTime
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
