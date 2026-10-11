import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BatchProcessingConfig, BatchQueueItem } from '../src/stores/batchQueueStore'

const {
  mockState,
  webdavServiceMock,
  cloudCacheServiceMock,
  metadataFormatterMock,
  aiBehavior,
  aiInstances,
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
      enableNotification: false,
      chapterConcurrency: 3,
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
    fetchCacheFileNamesStatus: vi.fn(),
    checkCacheStatus: vi.fn(),
    isCachedByFileName: vi.fn(),
    getCacheFilePath: vi.fn(),
    getChartsCacheFilePath: vi.fn(),
    uploadChartsJson: vi.fn(),
  },
  metadataFormatterMock: {
    generate: vi.fn(),
    formatUnified: vi.fn()
  },
  /** 可按测试覆写的章节摘要行为 */
  aiBehavior: {
    summarize: null as null | ((title: string, opts?: { signal?: AbortSignal }) => Promise<string>),
  },
  aiInstances: [] as unknown[],
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
    destroy = vi.fn().mockResolvedValue(undefined)
  }
}))

const epubDestroy = vi.fn()
vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: class {
    extractBookData = vi.fn().mockResolvedValue({
      title: 't',
      author: '',
      chapters: [{ id: '1', title: '第一章', content: 'A'.repeat(200) }],
    })
    destroy = epubDestroy
  }
}))

vi.mock('../src/services/aiService', () => {
  class MockAIService {
    private onTokenUsage?: (n: number) => void
    constructor(_cfg: unknown, _prompt: unknown, opts: { onTokenUsage?: (n: number) => void }) {
      this.onTokenUsage = opts?.onTokenUsage
      aiInstances.push(this)
    }
    summarizeChapter = vi.fn(
      async (title: string, _c: string, _b: string, _l: string, _p?: string, opts?: { signal?: AbortSignal }) => {
        this.onTokenUsage?.(10)
        return aiBehavior.summarize ? aiBehavior.summarize(title, opts) : `摘要:${title}`
      }
    )
    analyzeConnections = vi.fn().mockResolvedValue('章节关联')
    generateOverallSummary = vi.fn().mockResolvedValue('全书总结')
    generateKeyCharts = vi.fn().mockResolvedValue({
      version: 1,
      entityGraph: { nodes: [{ id: 'p1', name: '测试' }], edges: [] },
      entityTimeline: { entities: [{ id: 'p1', name: '测试' }], events: [] },
    })

    static isSkippedSummary(summary: string): boolean {
      return summary.startsWith('【已跳过】')
    }
  }

  return { AIService: MockAIService }
})

import {
  BATCH_CACHE_STATUS_UNKNOWN_ERROR,
  BATCH_UNSUPPORTED_MODE_ERROR,
  BatchProcessingEngine,
  defaultBatchChapterSelection,
} from '../src/services/batchProcessingEngine'
import { matchesDefaultUnselectTitle } from '../src/services/constants'

type BatchProcessingEngineInternals = {
  createAIService: (...args: unknown[]) => unknown
  extractChapters: (...args: unknown[]) => Promise<unknown>
  getRequestThrottleMs: (...args: unknown[]) => number
  processChapterSummary: (...args: unknown[]) => Promise<unknown>
  sleep: (...args: unknown[]) => Promise<void>
}

const internals = (engine: BatchProcessingEngine) =>
  engine as unknown as BatchProcessingEngineInternals

const twoChapters = [
  { id: '1', title: '第一章', content: 'A'.repeat(200) },
  { id: '2', title: '第二章', content: 'B'.repeat(220) }
]

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
    outputLanguage: 'zh',
    requestThrottleMs: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    aiBehavior.summarize = null
    aiInstances.length = 0

    mockState.processingOptions.processingMode = 'summary'

    cloudCacheServiceMock.fetchCacheFileNamesStatus.mockResolvedValue({ status: 'ok', names: new Set() })
    cloudCacheServiceMock.checkCacheStatus.mockResolvedValue('missing')
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(false)
    cloudCacheServiceMock.getCacheFilePath.mockReturnValue('/cache/book-完整摘要.md')
    cloudCacheServiceMock.uploadChartsJson.mockResolvedValue({ success: true, path: '/x.json' })

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
    vi.spyOn(internals(engine), 'createAIService').mockImplementation(() => {
      throw new Error('缺少 apiKey')
    })
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)

    const result = await engine.processItem(baseItem, baseConfig)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/AI 服务未初始化.*缺少 apiKey/)
    expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()
  })

  it('应按 requestThrottleMs 节流，并把局部 aiService 与 signal 逐层传入', async () => {
    const engine = new BatchProcessingEngine()
    vi.spyOn(internals(engine), 'getRequestThrottleMs').mockReturnValue(123)
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
    const summarySpy = vi
      .spyOn(internals(engine), 'processChapterSummary')
      .mockResolvedValue('章节摘要内容')
    const sleepSpy = vi.spyOn(internals(engine), 'sleep').mockResolvedValue(undefined)

    const result = await engine.processItem({ ...baseItem, selectedChapters: [2] }, baseConfig)

    expect(summarySpy).toHaveBeenCalledTimes(1)
    expect(summarySpy).toHaveBeenCalledWith(
      aiInstances[0],
      expect.objectContaining({ title: '第二章' }),
      'non-fiction',
      'zh',
      expect.any(AbortSignal)
    )
    expect(sleepSpy).toHaveBeenCalledWith(123)
    expect(result.success).toBe(true)
  })

  it('命中缓存列表时跳过并触发 onItemSkip', async () => {
    const engine = new BatchProcessingEngine()
    const onItemSkip = vi.fn()
    engine.setCallbacks({ onItemSkip })
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(true)

    const result = await engine.processItem(baseItem, { ...baseConfig, skipProcessed: true }, new Set(['x']))

    expect(result.success).toBe(true)
    expect(result.error).toContain('已跳过')
    expect(onItemSkip).toHaveBeenCalledWith(expect.objectContaining({ id: baseItem.id }), '已有缓存')
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
  })

  it('列表未命中时用三态复核：exists 跳过，unknown 致命失败且不下载', async () => {
    const engine = new BatchProcessingEngine()
    const config = { ...baseConfig, skipProcessed: true }

    cloudCacheServiceMock.checkCacheStatus.mockResolvedValueOnce('exists')
    expect((await engine.processItem(baseItem, config, new Set())).error).toContain('已跳过')

    cloudCacheServiceMock.checkCacheStatus.mockResolvedValueOnce('unknown')
    const unknown = await engine.processItem(baseItem, config, new Set())
    expect(unknown).toMatchObject({ success: false, fatal: true, error: BATCH_CACHE_STATUS_UNKNOWN_ERROR })
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
  })

  it('startProcessing：缓存列表状态未知时中止整批并报错', async () => {
    const engine = new BatchProcessingEngine()
    const onError = vi.fn()
    engine.setCallbacks({ onError })
    cloudCacheServiceMock.fetchCacheFileNamesStatus.mockResolvedValue({ status: 'unknown', error: '401' })

    await expect(
      engine.startProcessing([baseItem], { ...baseConfig, skipProcessed: true })
    ).rejects.toThrow(BATCH_CACHE_STATUS_UNKNOWN_ERROR)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
    expect(engine.getStatus().isRunning).toBe(false)
  })

  it('mindmap / combined-mindmap 模式明确拒绝，不下载不上传', async () => {
    for (const mode of ['mindmap', 'combined-mindmap']) {
      mockState.processingOptions.processingMode = mode
      const engine = new BatchProcessingEngine()
      await expect(engine.startProcessing([baseItem], baseConfig)).rejects.toThrow(
        BATCH_UNSUPPORTED_MODE_ERROR
      )
      const result = await engine.processItem(baseItem, baseConfig)
      expect(result).toMatchObject({ success: false, error: BATCH_UNSUPPORTED_MODE_ERROR })
    }
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
    expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()
  })

  it('单章失败只写占位：其余章节照常，后处理与上传只含可用章节并标记 isPartial', async () => {
    const engine = new BatchProcessingEngine()
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
    aiBehavior.summarize = async (title) => {
      if (title === '第一章') throw new Error('超时')
      return `摘要:${title}`
    }

    const result = await engine.processItem(baseItem, baseConfig)

    expect(result.success).toBe(true)
    expect(result.metadata).toMatchObject({ failedChapters: 1, processedChapters: 1, isPartial: true })
    const ai = aiInstances[0] as { analyzeConnections: ReturnType<typeof vi.fn> }
    expect(ai.analyzeConnections.mock.calls[0][0]).toEqual([
      expect.objectContaining({ title: '第二章' }),
    ])
    const bookData = metadataFormatterMock.formatUnified.mock.calls[0][0]
    expect(bookData.chapters.map((c: { title: string }) => c.title)).toEqual(['第二章'])
    expect(metadataFormatterMock.generate.mock.calls[0][0].isPartial).toBe(true)
    expect(webdavServiceMock.uploadFile).toHaveBeenCalledTimes(1)
    expect(cloudCacheServiceMock.uploadChartsJson).toHaveBeenCalledTimes(1)
  })

  it('无可用章节时不上传（避免空结果被 skipProcessed 永久跳过）', async () => {
    const engine = new BatchProcessingEngine()
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
    aiBehavior.summarize = async () => {
      throw new Error('全挂')
    }

    const result = await engine.processItem(baseItem, baseConfig)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/没有可用的章节摘要/)
    expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()
  })

  it('文件级并行：每个文件独立 AIService，token 计数不串号', async () => {
    const engine = new BatchProcessingEngine()
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
    const items = [baseItem, { ...baseItem, id: 'item-2', fileName: 'b.epub' }]

    const summary = await engine.startProcessing(items, { ...baseConfig, fileConcurrency: 2 })

    expect(summary.successCount).toBe(2)
    expect(aiInstances).toHaveLength(2)
    // 每本 2 章 × 10 token；若共享实例会串成 40
    for (const call of metadataFormatterMock.generate.mock.calls) {
      const { inputTokens, outputTokens } = call[0].aiResponseInfo
      expect(inputTokens + outputTokens).toBe(20)
    }
  })

  it('stop() 取消进行中的请求，结果标记为用户停止', async () => {
    const engine = new BatchProcessingEngine()
    vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
    let seenSignal: AbortSignal | undefined
    aiBehavior.summarize = (_title, opts) =>
      new Promise((_resolve, reject) => {
        seenSignal = opts?.signal
        opts?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        )
      })

    const pending = engine.startProcessing([baseItem], baseConfig)
    await vi.waitFor(() => expect(seenSignal).toBeDefined())
    engine.stop()
    const summary = await pending

    expect(seenSignal?.aborted).toBe(true)
    expect(summary.successCount).toBe(0)
    expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()

    // 停止后未重置：processItem 直接返回停止；重置后恢复
    expect((await engine.processItem(baseItem, baseConfig)).error).toBe('用户停止处理')
    engine.resetStopFlag()
    aiBehavior.summarize = null
    expect((await engine.processItem(baseItem, baseConfig)).success).toBe(true)
  })

  it('extractChapters 按格式动态加载解析器（大小写不敏感）并释放', async () => {
    const engine = new BatchProcessingEngine()
    const chapters = await internals(engine).extractChapters('BOOK.EPUB', new ArrayBuffer(4))
    expect(chapters).toEqual([expect.objectContaining({ title: '第一章' })])
    expect(epubDestroy).toHaveBeenCalledTimes(1)

    const txt = await internals(engine).extractChapters(
      'note.txt',
      new TextEncoder().encode('纯文本').buffer
    )
    expect(txt).toEqual([{ id: '1', title: '全文', content: '纯文本' }])
  })

  it('默认选章与单书一致：忽略类标题不选，全被忽略时回退全选', () => {
    const titles = ['第一章 开端', '致谢', '版权信息', '第二章']
    const expected = titles
      .map((t, i) => (matchesDefaultUnselectTitle(t) ? null : i + 1))
      .filter((n): n is number => n !== null)
    expect(defaultBatchChapterSelection(titles.map((title) => ({ title })))).toEqual(expected)
    expect(expected.length).toBeLessThan(titles.length)

    const allIgnored = [{ title: '致谢' }, { title: '版权信息' }]
    if (allIgnored.every((c) => matchesDefaultUnselectTitle(c.title))) {
      expect(defaultBatchChapterSelection(allIgnored)).toEqual([1, 2])
    }
  })
})
