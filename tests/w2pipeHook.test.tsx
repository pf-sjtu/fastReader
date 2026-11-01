/**
 * useBookProcessing 组合入口冒烟测试：S1 返回字段兼容、处理 → 缓存命中重跑、历史加载
 * （仅 mock 网络/SDK 边界：AI、解析器、WebDAV、同步服务）
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { create } from 'zustand'
import { mount } from './uiTestUtils'

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
    loading: vi.fn(() => 'tid'), dismiss: vi.fn(), message: vi.fn(),
  }),
  ai: {
    summarize: vi.fn(async (title: string) => `摘要:${title}`),
    connections: vi.fn(async () => '关联'),
    overall: vi.fn(async () => '全书'),
    charts: vi.fn(async () => ({ version: 1, entityGraph: { nodes: [{ id: 'p', name: '甲' }], edges: [] } })),
  },
  autoSync: { syncSummary: vi.fn(async () => true), syncChartsJson: vi.fn(async () => ({ success: true })), syncMindMap: vi.fn(async () => true) },
  webdav: {
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(async () => ({ success: true })),
    existsStatus: vi.fn(async () => 'missing'),
    getFileContents: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../src/services/autoSyncService', () => ({ autoSyncService: h.autoSync }))
vi.mock('../src/services/webdavService', () => ({ webdavService: h.webdav }))
vi.mock('../src/services/notificationService', () => ({
  notificationService: { sendTaskCompleteNotification: vi.fn(), sendErrorNotification: vi.fn() },
}))
vi.mock('../src/services/ai', () => ({
  AIService: class {
    summarizeChapter = h.ai.summarize
    analyzeConnections = h.ai.connections
    generateOverallSummary = h.ai.overall
    generateKeyCharts = h.ai.charts
    generateChapterMindMap = vi.fn()
    generateCombinedMindMap = vi.fn()
  },
}))
vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: class {
    extractBookData = vi.fn(async () => ({
      title: '测试书',
      author: '作者',
      chapters: [
        { id: 'chapter-1', title: '第一章', content: 'A'.repeat(300) },
        { id: 'chapter-2', title: '第二章', content: 'B'.repeat(300) },
      ],
    }))
    destroy = vi.fn(async () => {})
  },
}))
vi.mock('../src/stores/configStore', () => {
  const useConfigStore = create(() => ({
    tokenUsage: 0,
    addTokenUsage: vi.fn(),
    resetTokenUsage: vi.fn(),
    aiConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'k', apiUrl: '', temperature: 0.7 },
    aiServiceOptions: { maxRetries: 1, baseRetryDelay: 1 },
    // 提示词只有 v2（覆盖项模型）：这里给一份完整模板，pipeline 会读 chapterSummary.*
    promptConfig: {
      chapterSummary: {
        fiction: '小说 {{title}} \n{{content}}',
        nonFiction: '社科 {{title}} \n{{content}}',
      },
      mindmap: { chapter: '导图 {{title}}', arrow: '箭头', combined: '整书导图' },
      connectionAnalysis: '关联 {{chapterSummaries}}',
      overallSummary: '全书 《{{bookTitle}}》',
    },
    processingOptions: {
      processingMode: 'summary', bookType: 'non-fiction', useSmartDetection: false,
      skipNonEssentialChapters: true, maxSubChapterDepth: 0, outputLanguage: 'zh',
      chapterNamingMode: 'auto', enableNotification: false, chapterDetectionMode: 'normal',
      epubTocDepth: 1, chapterConcurrency: 2,
    },
    webdavConfig: { enabled: true, syncPath: '/fr', autoSync: true },
  }))
  return { useConfigStore }
})

import { useBookProcessing } from '../src/hooks/useBookProcessing'
import { formatUnifiedMarkdown, generateMetadata } from '../src/services/metadataFormatter'

type Api = ReturnType<typeof useBookProcessing>
const box: { api: Api | null } = { api: null }
function Harness() {
  box.api = useBookProcessing()
  return null
}
const api = () => box.api as Api

const S1_KEYS = [
  'file', 'processing', 'extractingChapters', 'progress', 'currentStep', 'currentProcessingChapter',
  'extractedChapters', 'bookData', 'selectedChapters', 'customPrompt', 'bookSummary', 'bookMindMap',
  'expandedChapters', 'cloudCacheMetadata', 'isCheckingCloudCache', 'cloudCacheContent',
  'cloudCacheIsPartial', 'cloudCacheStatusUnknown', 'cloudChartsFileFound', 'chartsGenerating',
  'rightPanelContent', 'currentViewingChapter', 'currentViewingChapterSummary', 'previewFontSize',
  'isPreviewFullscreen', 'previewCardRef', 'isWebDAVBrowserOpen', 'tokenUsage', 'processingMode',
  'handleFileSelect', 'extractChapters', 'processBook', 'cancelProcessing', 'restartProcessing',
  'handleChapterSelect', 'handleSelectAll', 'handleViewChapterContent', 'handleCloseRightPanel',
  'handleChapterExpandChange', 'clearChapterCache', 'clearChapterMindMapCache', 'clearSpecificCache',
  'regenerateKeyCharts', 'cancelKeyCharts', 'clearBookCache', 'increasePreviewFontSize', 'decreasePreviewFontSize',
  'togglePreviewFullscreen', 'loadFromCloudCache', 'handleWebDAVFileSelect', 'openWebDAVBrowser',
  'handleChapterSummaryNavigation', 'handleChapterNavigation', 'loadFromHistoryRecord',
  'setCustomPrompt', 'setSelectedChapters', 'setIsWebDAVBrowserOpen', 'setBookSummary',
  'setBookMindMap', 'setCurrentViewingChapterSummary', 'fullBookData',
]

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 20))
})

describe('useBookProcessing 组合入口', () => {
  beforeEach(() => vi.clearAllMocks())

  it('S1：返回字段与拆分前一致', () => {
    const m = mount(<Harness />)
    expect(Object.keys(api()).sort()).toEqual([...S1_KEYS].sort())
    m.unmount()
  })

  it('选书 → 处理 → 重新处理全部命中本地缓存（不再调用 AI）→ 清单章后只重跑该章', async () => {
    const m = mount(<Harness />)
    const file = new File([new TextEncoder().encode('epub-bytes-1')], 'w2pipe-hook.epub', { lastModified: 7 })
    await act(async () => {
      await api().handleFileSelect(file)
    })
    await flush()
    expect(api().extractedChapters).toHaveLength(2)
    expect([...api().selectedChapters]).toEqual(['chapter-1', 'chapter-2'])

    await act(async () => {
      await api().processBook()
    })
    await flush()
    expect(api().bookSummary).toMatchObject({ title: '测试书', overallSummary: '全书', connections: '关联' })
    expect(api().bookSummary?.charts).toBeTruthy()
    expect(api().progress).toBe(100)
    expect(h.ai.summarize).toHaveBeenCalledTimes(2)
    expect(h.autoSync.syncSummary).toHaveBeenCalledTimes(1)
    expect(h.autoSync.syncChartsJson).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    await act(async () => {
      await api().restartProcessing()
    })
    await flush()
    expect(h.ai.summarize).not.toHaveBeenCalled()
    expect(h.ai.overall).not.toHaveBeenCalled()
    expect(api().bookSummary?.chapters.map((c) => c.summary)).toEqual(['摘要:第一章', '摘要:第二章'])

    act(() => api().clearChapterCache('chapter-1'))
    await flush()
    expect(api().bookSummary?.chapters[0].processed).toBe(false)
    await act(async () => {
      await api().restartProcessing()
    })
    await flush()
    expect(h.ai.summarize).toHaveBeenCalledTimes(1)
    expect(h.ai.summarize.mock.calls[0][0]).toBe('第一章')
    m.unmount()
  })

  it('历史加载：解析云端 MD；缺图表时不自动调 AI，用户点「生成」才调', async () => {
    const content = formatUnifiedMarkdown(
      { title: '云书', author: '', chapters: [{ id: '1', title: '一', summary: '摘一' }], overallSummary: '总' },
      generateMetadata({
        fileName: 'cloud.epub', model: 'm', chapterDetectionMode: 'normal',
        selectedChapters: [1], chapterCount: 1, originalCharCount: 1, processedCharCount: 1,
      })
    )
    h.webdav.getFileContents.mockImplementation(async (path: string) =>
      path.endsWith('.md') ? { success: true, data: content } : { success: false, error: '404 Not Found' }
    )
    const m = mount(<Harness />)
    let ok = false
    await act(async () => {
      ok = await api().loadFromHistoryRecord('cloud.epub')
    })
    await flush()
    expect(ok).toBe(true)
    expect(api().bookSummary?.title).toBe('云书')
    expect(api().cloudCacheContent).toBe(content)
    // 打开已精读的书不花钱：加载完成后没有任何图表生成调用
    expect(h.ai.charts).not.toHaveBeenCalled()
    await act(async () => {
      await api().regenerateKeyCharts()
    })
    await flush()
    expect(h.ai.charts).toHaveBeenCalledTimes(1)
    expect(h.autoSync.syncChartsJson.mock.calls[0][0]).toBe('cloud.epub')
    m.unmount()
  })

  it('处理完成的提示带本次 token 账单；没有用量时不带', async () => {
    const { useConfigStore } = await import('../src/stores/configStore')
    const m = mount(<Harness />)
    await act(async () => {
      await api().handleFileSelect(new File([new TextEncoder().encode('epub-bytes-bill')], 'bill.epub', { lastModified: 9 }))
    })
    await flush()
    h.ai.summarize.mockImplementationOnce(async (title: string) => {
      ;(useConfigStore as unknown as { setState: (s: object) => void }).setState({ tokenUsage: 12_345 })
      return `摘要:${title}`
    })
    h.toast.success.mockClear()
    await act(async () => {
      await api().processBook()
    })
    await flush()
    const done = h.toast.success.mock.calls.at(-1)
    expect(done?.[1]).toMatchObject({ description: expect.stringContaining('1.2 万') })
    ;(useConfigStore as unknown as { setState: (s: object) => void }).setState({ tokenUsage: 0 })
    m.unmount()
  })

  it('生成关键图表中途取消：不记失败（无 chartsError）、不上传，状态复位，之后还能再生成', async () => {
    const content = formatUnifiedMarkdown(
      { title: '云书', author: '', chapters: [{ id: '1', title: '一', summary: '摘一' }], overallSummary: '总' },
      generateMetadata({
        fileName: 'cx.epub', model: 'm', chapterDetectionMode: 'normal',
        selectedChapters: [1], chapterCount: 1, originalCharCount: 1, processedCharCount: 1,
      })
    )
    h.webdav.getFileContents.mockImplementation(async (path: string) =>
      path.endsWith('.md') ? { success: true, data: content } : { success: false, error: '404 Not Found' }
    )
    const m = mount(<Harness />)
    await act(async () => {
      await api().loadFromHistoryRecord('cx.epub')
    })
    await flush()
    // 调用挂起，直到收到 abort 信号才以 AbortError 结束（与真实 fetch 一致）
    h.ai.charts.mockImplementationOnce(
      (...args: unknown[]) =>
        new Promise((_, reject) => {
          const signal = (args[5] as { signal?: AbortSignal } | undefined)?.signal
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = api().regenerateKeyCharts() as Promise<void>
    })
    await flush()
    expect(api().chartsGenerating).toBe(true)
    act(() => api().cancelKeyCharts())
    await act(async () => {
      await pending
    })
    expect(api().chartsGenerating).toBe(false)
    expect(api().bookSummary?.chartsError ?? null).toBeNull()
    expect(api().bookSummary?.charts ?? null).toBeNull()
    expect(h.autoSync.syncChartsJson).not.toHaveBeenCalled()
    // 取消后还能正常再生成
    await act(async () => {
      await api().regenerateKeyCharts()
    })
    await flush()
    expect(api().bookSummary?.charts).not.toBeNull()
    m.unmount()
  })

  it('选书时发现云端缓存（不完整）→ 直接加载；清除图表 / 关联 / 全书', async () => {
    const content = formatUnifiedMarkdown(
      { title: '云书', author: '', chapters: [{ id: '1', title: '一', summary: '摘一' }], overallSummary: '总', connections: '联' },
      generateMetadata({
        fileName: 'c2.epub', model: 'm', chapterDetectionMode: 'normal', isPartial: true,
        selectedChapters: [1], chapterCount: 1, originalCharCount: 1, processedCharCount: 1,
      })
    )
    h.webdav.existsStatus.mockResolvedValueOnce('exists')
    h.webdav.getFileContents.mockImplementation(async (path: string) =>
      path.endsWith('.md') ? { success: true, data: content } : { success: false, error: '404' }
    )
    const m = mount(<Harness />)
    await act(async () => {
      await api().handleFileSelect(new File([new TextEncoder().encode('x')], 'c2.epub'))
    })
    await flush()
    expect(api().cloudCacheContent).toBe(content)
    expect(api().cloudCacheIsPartial).toBe(true)
    let ok = false
    await act(async () => {
      ok = await api().loadFromCloudCache()
    })
    await flush()
    expect(ok).toBe(true)
    expect(api().bookSummary?.overallSummary).toBe('总')
    expect(h.toast.warning).toHaveBeenCalled() // 不完整提示
    expect(h.ai.charts).not.toHaveBeenCalled() // 不完整缓存不自动补图

    act(() => api().clearSpecificCache('connections'))
    act(() => api().clearSpecificCache('overall_summary'))
    act(() => api().clearSpecificCache('key_charts'))
    act(() => api().clearSpecificCache('merged_mindmap'))
    act(() => api().clearSpecificCache('selected_chapters'))
    await flush()
    expect(api().bookSummary).toMatchObject({ connections: '', overallSummary: '', charts: null })
    act(() => api().clearBookCache())
    await flush()
    expect(api().bookSummary).toBeNull()
    m.unmount()
  })

  it('云端状态未知时提示；取消处理；阅读面板动作', async () => {
    h.webdav.existsStatus.mockResolvedValueOnce('unknown')
    const m = mount(<Harness />)
    await act(async () => {
      await api().handleFileSelect(new File([new TextEncoder().encode('y')], 'u.epub'))
    })
    await flush()
    expect(api().cloudCacheStatusUnknown).toBe(true)

    h.ai.summarize.mockImplementationOnce(
      (_t: string, _c: string, _b: string, _l: string, _p: string, opts?: { signal?: AbortSignal }) =>
        new Promise((_, reject) =>
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        )
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = api().processBook()
    })
    await flush()
    act(() => api().cancelProcessing())
    await act(async () => {
      await pending
    })
    expect(api().processing).toBe(false)
    expect(h.toast.info).toHaveBeenCalled()

    const chapter = api().extractedChapters![0]
    act(() => api().handleViewChapterContent(chapter))
    expect(api().rightPanelContent?.title).toBe('第一章')
    act(() => api().handleCloseRightPanel())
    act(() => api().handleChapterNavigation('chapter-2'))
    expect(api().currentViewingChapter).toBe('chapter-2')
    act(() => api().increasePreviewFontSize())
    act(() => api().decreasePreviewFontSize())
    act(() => api().decreasePreviewFontSize())
    expect(api().previewFontSize).toBe(14)
    act(() => api().handleChapterExpandChange('chapter-1', true))
    expect([...api().expandedChapters]).toEqual(['chapter-1'])
    act(() => api().handleChapterExpandChange('chapter-1', false))
    act(() => api().handleChapterSummaryNavigation('chapter-2'))
    expect(api().currentViewingChapterSummary).toBe('chapter-2')
    act(() => api().handleSelectAll(false))
    expect(api().selectedChapters.size).toBe(0)
    act(() => api().handleChapterSelect('chapter-1', true))
    expect([...api().selectedChapters]).toEqual(['chapter-1'])
    act(() => api().openWebDAVBrowser())
    expect(api().isWebDAVBrowserOpen).toBe(true)
    m.unmount()
  })
})
