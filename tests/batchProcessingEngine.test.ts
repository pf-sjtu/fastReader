import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BatchProcessingConfig, BatchQueueItem } from '../src/stores/batchQueueStore'

const {
  mockState,
  webdavServiceMock,
  cloudCacheServiceMock,
  metadataFormatterMock,
  aiBehavior,
  aiInstances,
  cacheFactory,
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
    // 提示词只有 v2（覆盖项模型）：给一份完整模板，pipeline 会读 chapterSummary.*
    promptConfig: {
      chapterSummary: {
        fiction: '小说 {{title}} \n{{content}}',
        nonFiction: '社科 {{title}} \n{{content}}',
      },
      mindmap: { chapter: '导图 {{title}}', arrow: '箭头', combined: '整书导图' },
      connectionAnalysis: '关联 {{chapterSummaries}}',
      overallSummary: '全书 《{{bookTitle}}》 {{chapterInfo}} {{connections}}',
    },
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
    uploadFile: vi.fn(),
    syncFiles: vi.fn(),
  },
  cloudCacheServiceMock: {
    fetchCacheFileNamesStatus: vi.fn(),
    checkCacheStatus: vi.fn(),
    isCachedByFileName: vi.fn(),
    getCacheFilePath: vi.fn(),
    getChartsCacheFilePath: vi.fn(),
    uploadChartsJson: vi.fn(),
    readCacheMetadata: vi.fn(),
    readMindMapManifest: vi.fn(),
    getMindMapManifestPath: vi.fn(),
  },
  metadataFormatterMock: {
    generate: vi.fn(),
    formatUnified: vi.fn()
  },
  /** 可按测试覆写的章节摘要行为 */
  aiBehavior: {
    summarize: null as null | ((title: string, opts?: { signal?: AbortSignal }) => Promise<string>),
    mindmap: null as null | ((title: string) => unknown),
  },
  aiInstances: [] as unknown[],
  cacheFactory: { make: null as null | (() => unknown) },
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

vi.mock('../src/services/pipeline/persistence', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/pipeline/persistence')>()
  return { ...real, createLocalPipelineCache: async () => cacheFactory.make?.() ?? null }
})

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

vi.mock('../src/services/ai', () => {
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

    generateChapterMindMap = vi.fn(async (title: string) => {
      this.onTokenUsage?.(5)
      return aiBehavior.mindmap ? aiBehavior.mindmap(title) : { nodeData: { id: 'r', topic: title } }
    })
    generateCombinedMindMap = vi.fn().mockResolvedValue({ nodeData: { id: 'r', topic: '整书' } })

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
  sleep: (...args: unknown[]) => Promise<void>
}

type MockAI = { [k: string]: ReturnType<typeof vi.fn> }

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
    aiBehavior.mindmap = null
    aiInstances.length = 0
    cacheFactory.make = null

    mockState.processingOptions.processingMode = 'summary'

    cloudCacheServiceMock.fetchCacheFileNamesStatus.mockResolvedValue({ status: 'ok', names: new Set() })
    cloudCacheServiceMock.checkCacheStatus.mockResolvedValue('missing')
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(false)
    cloudCacheServiceMock.getCacheFilePath.mockReturnValue('/cache/book-完整摘要.md')
    cloudCacheServiceMock.uploadChartsJson.mockResolvedValue({ success: true, path: '/x.json' })
    cloudCacheServiceMock.readCacheMetadata.mockResolvedValue({ status: 'ok', metadata: { isPartial: false } })
    cloudCacheServiceMock.readMindMapManifest.mockResolvedValue({ status: 'missing' })
    cloudCacheServiceMock.getMindMapManifestPath.mockReturnValue('/cache/book/book_mindmap_manifest.json')
    webdavServiceMock.syncFiles.mockResolvedValue({ success: true })

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
    const sleepSpy = vi.spyOn(internals(engine), 'sleep').mockResolvedValue(undefined)

    const result = await engine.processItem({ ...baseItem, selectedChapters: [2] }, baseConfig)

    const ai = aiInstances[0] as MockAI
    expect(ai.summarizeChapter).toHaveBeenCalledTimes(1)
    const call = ai.summarizeChapter.mock.calls[0]
    expect(call[0]).toBe('第二章')
    expect(call.slice(2, 4)).toEqual(['non-fiction', 'zh'])
    expect(call[5].signal).toBeInstanceOf(AbortSignal)
    expect(sleepSpy).toHaveBeenCalledWith(123)
    expect(result.success).toBe(true)
  })

  it('命中缓存列表时跳过并触发 onItemSkip', async () => {
    const engine = new BatchProcessingEngine()
    const onItemSkip = vi.fn()
    engine.setCallbacks({ onItemSkip })
    cloudCacheServiceMock.isCachedByFileName.mockReturnValue(true)

    const result = await engine.processItem(baseItem, { ...baseConfig, skipProcessed: true }, new Set(['x']))

    expect(result).toMatchObject({ success: true, skipped: true })
    expect(result.error).toContain('已跳过')
    expect(cloudCacheServiceMock.readCacheMetadata).toHaveBeenCalledWith('book.epub')
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

  it('未知模式明确拒绝，不下载不上传', async () => {
    mockState.processingOptions.processingMode = 'weird'
    const engine = new BatchProcessingEngine()
    await expect(engine.startProcessing([baseItem], baseConfig)).rejects.toThrow(BATCH_UNSUPPORTED_MODE_ERROR)
    const result = await engine.processItem(baseItem, baseConfig)
    expect(result.success).toBe(false)
    expect(result.error).toContain(BATCH_UNSUPPORTED_MODE_ERROR)
    expect(webdavServiceMock.getFileContents).not.toHaveBeenCalled()
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
    // 纯文本与单本处理同一条路径：书名取文件名主干，不再合成一章「全文」
    expect(txt).toEqual([{ id: '1', title: 'note', content: '纯文本' }])

    const md = await internals(engine).extractChapters(
      '笔记.md',
      new TextEncoder().encode('# 一\n正文一\n# 二\n正文二').buffer
    )
    expect(md).toEqual([
      { id: '1', title: '一', content: '正文一' },
      { id: '2', title: '二', content: '正文二' },
    ])
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
  describe('w2pipe：skipProcessed 读元数据 / 导图模式 / 本地缓存', () => {
    const skipCfg = { ...baseConfig, skipProcessed: true }

    it('summary：文件名命中但 isPartial=true 不跳过；元数据读不到按已处理跳过', async () => {
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      cloudCacheServiceMock.isCachedByFileName.mockReturnValue(true)
      cloudCacheServiceMock.readCacheMetadata.mockResolvedValueOnce({ status: 'ok', metadata: { isPartial: true } })
      const r1 = await engine.processItem(baseItem, skipCfg, new Set(['x']))
      expect(r1.skipped).toBeUndefined()
      expect(r1.success).toBe(true)
      expect(webdavServiceMock.uploadFile).toHaveBeenCalledTimes(1)

      cloudCacheServiceMock.readCacheMetadata.mockResolvedValueOnce({ status: 'unknown', error: 'x' })
      expect((await engine.processItem(baseItem, skipCfg, new Set(['x']))).skipped).toBe(true)
      // 列表未命中、三态 exists 时同样读元数据
      cloudCacheServiceMock.isCachedByFileName.mockReturnValue(false)
      cloudCacheServiceMock.checkCacheStatus.mockResolvedValueOnce('exists')
      cloudCacheServiceMock.readCacheMetadata.mockResolvedValueOnce({ status: 'ok', metadata: null })
      expect((await engine.processItem(baseItem, skipCfg, new Set())).skipped).toBe(true)
    })

    it('汇总按 skipped 字段统计跳过数', async () => {
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      cloudCacheServiceMock.isCachedByFileName.mockImplementation((name: string) => name === 'book.epub')
      const summary = await engine.startProcessing(
        [baseItem, { ...baseItem, id: 'i2', fileName: 'other.epub' }],
        skipCfg
      )
      expect(summary).toMatchObject({ skippedCount: 1, successCount: 1, failedCount: 0 })
    })

    it('mindmap：处理并上传导图包，失败章节使 isPartial；不列 MD 目录', async () => {
      mockState.processingOptions.processingMode = 'mindmap'
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      aiBehavior.mindmap = (title) => (title === '第二章' ? null : { nodeData: { id: 'r', topic: title } })
      const summary = await engine.startProcessing([baseItem], skipCfg)
      expect(cloudCacheServiceMock.fetchCacheFileNamesStatus).not.toHaveBeenCalled()
      expect(summary.successCount).toBe(1)
      const res = summary.results[0]
      expect(res.metadata).toMatchObject({ processedChapters: 1, failedChapters: 1, isPartial: true })
      expect(res.outputPath).toBe('/cache/book/book_mindmap_manifest.json')
      expect(webdavServiceMock.syncFiles).toHaveBeenCalledTimes(1)
      const manifest = JSON.parse(webdavServiceMock.uploadFile.mock.calls[0][1])
      expect(manifest).toMatchObject({ mode: 'mindmap', isPartial: true, failedChapters: 1 })
      const ai = aiInstances[0] as MockAI
      expect(ai.generateCombinedMindMap).not.toHaveBeenCalled()
    })

    it('combined-mindmap：生成整书导图；全部失败或上传失败时报错不写标记', async () => {
      mockState.processingOptions.processingMode = 'combined-mindmap'
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      const ok = await engine.processItem(baseItem, baseConfig)
      expect(ok.metadata?.isPartial).toBe(false)
      expect((aiInstances[0] as MockAI).generateCombinedMindMap).toHaveBeenCalledTimes(1)

      aiBehavior.mindmap = () => null
      const none = await engine.processItem(baseItem, baseConfig)
      expect(none.error).toMatch(/没有可用的章节导图/)

      aiBehavior.mindmap = null
      webdavServiceMock.syncFiles.mockResolvedValueOnce({ success: false, error: '部分文件上传失败' })
      webdavServiceMock.uploadFile.mockClear()
      const failed = await engine.processItem(baseItem, baseConfig)
      expect(failed).toMatchObject({ success: false, error: '部分文件上传失败' })
      expect(webdavServiceMock.uploadFile).not.toHaveBeenCalled()
    })

    it('导图 skipProcessed：完整标记跳过；不完整 / 模式不符处理；未知致命', async () => {
      mockState.processingOptions.processingMode = 'combined-mindmap'
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      const m = cloudCacheServiceMock.readMindMapManifest
      m.mockResolvedValueOnce({ status: 'ok', manifest: { mode: 'combined-mindmap', isPartial: false } })
      expect((await engine.processItem(baseItem, skipCfg)).skipped).toBe(true)
      m.mockResolvedValueOnce({ status: 'ok', manifest: { mode: 'mindmap', isPartial: false } })
      expect((await engine.processItem(baseItem, skipCfg)).skipped).toBeUndefined()
      m.mockResolvedValueOnce({ status: 'ok', manifest: { mode: 'combined-mindmap', isPartial: true } })
      expect((await engine.processItem(baseItem, skipCfg)).skipped).toBeUndefined()
      m.mockResolvedValueOnce({ status: 'unknown', error: 'x' })
      expect(await engine.processItem(baseItem, skipCfg)).toMatchObject({ fatal: true })

      mockState.processingOptions.processingMode = 'mindmap'
      m.mockResolvedValueOnce({ status: 'ok', manifest: { mode: 'combined-mindmap', isPartial: false } })
      expect((await engine.processItem(baseItem, skipCfg)).skipped).toBe(true)
    })

    it('本地缓存：重跑同一本时命中章节不再调用 AI', async () => {
      const store = new Map<string, unknown>()
      cacheFactory.make = () => ({
        getChapter: async (_k: string, ch: { id: string }) => store.get(ch.id) ?? null,
        setChapter: async (_k: string, ch: { id: string }, v: unknown) => void store.set(ch.id, v),
        getBook: async (k: string) => store.get(k) ?? null,
        setBook: async (k: string, _i: string, v: unknown) => void store.set(k, v),
      })
      const engine = new BatchProcessingEngine()
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      await engine.processItem(baseItem, baseConfig)
      const second = await engine.processItem(baseItem, baseConfig)
      expect((aiInstances[1] as MockAI).summarizeChapter).not.toHaveBeenCalled()
      expect(second.metadata).toMatchObject({ cachedChapters: 2, isPartial: false })
    })

    it('下载失败、无章节、上传失败时报错', async () => {
      const engine = new BatchProcessingEngine()
      webdavServiceMock.getFileContents.mockResolvedValueOnce({ success: false, error: '404' })
      expect((await engine.processItem(baseItem, baseConfig)).error).toBe('404')
      webdavServiceMock.getFileContents.mockRejectedValueOnce(new Error('断网'))
      expect((await engine.processItem(baseItem, baseConfig)).error).toBe('断网')
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue([])
      expect((await engine.processItem(baseItem, baseConfig)).error).toBe('未能提取到任何章节')
      webdavServiceMock.uploadFile.mockResolvedValueOnce({ success: false, error: '满了' })
      vi.spyOn(internals(engine), 'extractChapters').mockResolvedValue(twoChapters)
      expect((await engine.processItem(baseItem, baseConfig)).error).toBe('满了')
    })

    it('pause / resume / getRequestThrottleMs 默认值', () => {
      const engine = new BatchProcessingEngine()
      engine.pause()
      expect(engine.getStatus().isPaused).toBe(true)
      engine.resume()
      expect(engine.getStatus().isPaused).toBe(false)
      expect(internals(engine).getRequestThrottleMs({ ...baseConfig, requestThrottleMs: undefined })).toBe(100)
      expect(internals(engine).getRequestThrottleMs({ ...baseConfig, requestThrottleMs: -5 })).toBe(0)
    })
  })
})
