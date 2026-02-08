import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BatchProcessingConfig, BatchQueueItem } from '../src/stores/batchQueueStore'

const {
  mockState,
  webdavServiceMock,
  cloudCacheServiceMock,
  metadataFormatterMock
} = vi.hoisted(() => ({
  mockState: {
    aiConfig: {
      provider: 'openai',
      apiKey: 'test-key',
      apiUrl: 'https://api.example.com/v1',
      model: 'test-model',
      temperature: 0.7,
      proxyUrl: '',
      proxyEnabled: false
    },
    aiServiceOptions: {
      maxRetries: 1,
      baseRetryDelay: 10
    },
    promptConfig: {},
    processingOptions: {
      processingMode: 'summary',
      bookType: 'non-fiction',
      useSmartDetection: false,
      skipNonEssentialChapters: true,
      maxSubChapterDepth: 0,
      outputLanguage: 'zh',
      chapterNamingMode: 'auto',
      chapterDetectionMode: 'normal',
      epubTocDepth: 1,
      enableNotification: false
    },
    config: {
      requestThrottleMs: 0
    }
  },
  webdavServiceMock: {
    getFileContents: vi.fn(),
    uploadFile: vi.fn()
  },
  cloudCacheServiceMock: {
    fetchCacheFileNames: vi.fn(),
    isCachedByFileName: vi.fn(),
    getCacheFilePath: vi.fn()
  },
  metadataFormatterMock: {
    generate: vi.fn(),
    formatUnified: vi.fn()
  }
}))

vi.mock('../src/stores/configStore', () => ({
  useConfigStore: {
    getState: () => mockState
  }
}))

vi.mock('../src/services/webdavService', () => ({
  webdavService: webdavServiceMock
}))

vi.mock('../src/services/cloudCacheService', () => ({
  cloudCacheService: cloudCacheServiceMock
}))

vi.mock('../src/services/metadataFormatter', () => ({
  metadataFormatter: metadataFormatterMock
}))

vi.mock('../src/services/pdfProcessor', () => ({
  PdfProcessor: class {
    extractChapters = vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../src/services/aiService', () => {
  class MockAIService {
    summarizeChapter = vi.fn().mockResolvedValue('章节摘要')
    analyzeConnections = vi.fn().mockResolvedValue('章节关联')
    generateOverallSummary = vi.fn().mockResolvedValue('全书总结')

    static isSkippedSummary(summary: string): boolean {
      return summary.startsWith('【已跳过】')
    }
  }

  return { AIService: MockAIService }
})

import { BatchProcessingEngine } from '../src/services/batchProcessingEngine'

type BatchProcessingEngineInternals = {
  extractChapters: (...args: unknown[]) => Promise<unknown>
  getRequestThrottleMs: (...args: unknown[]) => number
  processChapterSummary: (...args: unknown[]) => Promise<unknown>
  sleep: (...args: unknown[]) => Promise<void>
}

describe('BatchProcessingEngine 行为测试', () => {
  const baseItem: BatchQueueItem = {
    id: 'item-1',
    fileName: 'book.epub',
    filePath: '/books/book.epub',
    status: 'pending',
    progress: 0
  }

  const baseConfig: BatchProcessingConfig = {
    sourcePath: '/books',
    maxFiles: 0,
    skipProcessed: false,
    order: 'sequential',
    bookType: 'non-fiction',
    processingMode: 'summary',
    chapterDetectionMode: 'normal',
    outputLanguage: 'zh'
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockState.processingOptions.processingMode = 'summary'
    mockState.config.requestThrottleMs = 0

    cloudCacheServiceMock.fetchCacheFileNames.mockResolvedValue(new Set())
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(false)
    cloudCacheServiceMock.getCacheFilePath.mockReturnValue('/cache/book-完整摘要.md')

    webdavServiceMock.getFileContents.mockResolvedValue({
      success: true,
      data: new ArrayBuffer(8)
    })
    webdavServiceMock.uploadFile.mockResolvedValue({ success: true })

    metadataFormatterMock.generate.mockReturnValue({ costUSD: 0, costRMB: 0 })
    metadataFormatterMock.formatUnified.mockReturnValue('# 处理结果')
  })

  it('AI 服务不可用时应返回可诊断失败信息', async () => {
    const engine = new BatchProcessingEngine()
    const engineWithInternals = engine as unknown as { aiService: unknown }
    const internalEngine = engine as unknown as BatchProcessingEngineInternals
    engineWithInternals.aiService = null

    const extractChaptersSpy = vi
      .spyOn(internalEngine, 'extractChapters')
      .mockResolvedValue([{ id: '1', title: '第一章', content: 'A'.repeat(300) }])

    const result = await engine.processItem(baseItem, baseConfig)

    expect(extractChaptersSpy).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
    expect(result.error).toContain('AI 服务未初始化')
    expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()
  })

  it('应按 requestThrottleMs 对选中章节执行节流等待', async () => {
    const engine = new BatchProcessingEngine()

    const internalEngine = engine as unknown as BatchProcessingEngineInternals

    const getRequestThrottleMsSpy = vi
      .spyOn(internalEngine, 'getRequestThrottleMs')
      .mockReturnValue(123)

    const extractChaptersSpy = vi
      .spyOn(internalEngine, 'extractChapters')
      .mockResolvedValue([
        { id: '1', title: '第一章', content: 'A'.repeat(200) },
        { id: '2', title: '第二章', content: 'B'.repeat(220) }
      ])

    const processChapterSummarySpy = vi
      .spyOn(internalEngine, 'processChapterSummary')
      .mockResolvedValue('章节摘要内容')

    const sleepSpy = vi
      .spyOn(internalEngine, 'sleep')
      .mockResolvedValue(undefined)

    const result = await engine.processItem(
      { ...baseItem, selectedChapters: [2] },
      baseConfig
    )

    expect(extractChaptersSpy).toHaveBeenCalledTimes(1)
    expect(processChapterSummarySpy).toHaveBeenCalledTimes(1)
    expect(processChapterSummarySpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: '第二章' }),
      'non-fiction',
      'zh'
    )
    expect(sleepSpy).toHaveBeenCalledTimes(1)
    expect(getRequestThrottleMsSpy).toHaveBeenCalledTimes(1)
    expect(sleepSpy).toHaveBeenCalledWith(123)
    expect(result.success).toBe(true)
  })

  it('命中缓存时应跳过并触发 onItemSkip 回调', async () => {
    const engine = new BatchProcessingEngine()
    const onItemSkip = vi.fn()

    engine.setCallbacks({ onItemSkip })

    const cached = new Set(['book.epub'])
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(true)

    const result = await engine.processItem(
      baseItem,
      { ...baseConfig, skipProcessed: true },
      cached
    )

    expect(result.success).toBe(true)
    expect(result.error).toContain('已跳过')
    expect(onItemSkip).toHaveBeenCalledTimes(1)
    expect(onItemSkip).toHaveBeenCalledWith(
      expect.objectContaining({ id: baseItem.id }),
      '已有缓存'
    )
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
  })
})
