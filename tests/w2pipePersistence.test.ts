import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { autoSyncMock, webdavMock, davConfig } = vi.hoisted(() => ({
  autoSyncMock: {
    syncSummary: vi.fn(),
    syncChartsJson: vi.fn(),
    syncMindMap: vi.fn(),
  },
  webdavMock: {
    syncFiles: vi.fn(),
    uploadFile: vi.fn(),
    getFileContents: vi.fn(),
    existsStatus: vi.fn(),
  },
  davConfig: { syncPath: '/fr', enabled: true },
}))

vi.mock('../src/services/autoSyncService', () => ({ autoSyncService: autoSyncMock }))
vi.mock('../src/services/webdavService', () => ({ webdavService: webdavMock }))
vi.mock('../src/stores/configStore', () => ({
  useConfigStore: { getState: () => ({ webdavConfig: davConfig }) },
}))

import { CacheService } from '../src/services/cacheService'
import {
  bookPrefix,
  buildEntryKey,
  canHash,
  entryPrefix,
  fileFingerprint,
  nameBookId,
  sha256Hex,
} from '../src/services/pipeline/cacheKeys'
import {
  clearBookEntries,
  clearChapterEntries,
  clearKindEntries,
  createLocalPipelineCache,
  readChartsArtifact,
  recordHistory,
  resolveOutputLanguage,
  resolvePromptTemplates,
  saveChartsArtifact,
  syncMindMapResult,
  syncSummaryResult,
  uploadMindMapBundle,
  type LocalCacheContext,
} from '../src/services/pipeline/persistence'
import { useProcessingHistoryStore } from '../src/stores/processingHistory'
import i18n from '../src/i18n'

let seq = 0
const freshStore = () => new CacheService({ dbName: `w2pipe-persist-${++seq}` })

const ctx = (over: Partial<LocalCacheContext> = {}): LocalCacheContext => ({
  bookId: 'book1',
  modelId: 'openai:gpt-4o',
  outputLanguage: 'zh',
  bookType: 'non-fiction',
  promptConfig: null,
  customPrompt: '',
  ...over,
})

const ch = { id: 'chapter-1', title: '第一章', content: '正文'.repeat(80) }
const charts = { version: 1, entityGraph: { nodes: [{ id: 'p', name: '人' }], edges: [] } }

describe('cacheKeys', () => {
  it('sha256 与文件指纹：size / lastModified / 头部内容任一变化都改变指纹', async () => {
    expect(canHash()).toBe(true)
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const bytes = new TextEncoder().encode('hello world')
    const fp = await fileFingerprint({ size: 11, lastModified: 1, head: bytes })
    expect(fp).toHaveLength(32)
    expect(await fileFingerprint({ size: 11, lastModified: 1, head: bytes.buffer })).toBe(fp)
    expect(await fileFingerprint({ size: 11, lastModified: 2, head: bytes })).not.toBe(fp)
    expect(await fileFingerprint({ size: 12, lastModified: 1, head: bytes })).not.toBe(fp)
    const file = new File([bytes], 'a.epub', { lastModified: 1 })
    expect(await fileFingerprint(file)).toBe(fp)
    // 只看前 64KB
    const big = new Uint8Array(70 * 1024)
    const big2 = big.slice()
    big2[69 * 1024] = 1
    expect(await fileFingerprint({ size: 1, head: big })).toBe(await fileFingerprint({ size: 1, head: big2 }))
  })

  it('键结构：按书 / 类型 / 章节分组，parts 决定哈希', async () => {
    const k1 = await buildEntryKey('B', 'summary', 'c/1', ['x'])
    expect(k1.startsWith(entryPrefix('B', 'summary', 'c/1'))).toBe(true)
    expect(k1.startsWith(bookPrefix('B'))).toBe(true)
    expect(entryPrefix('B', 'summary', 'c/1')).toBe('frc1:B:summary:c%2F1:')
    expect(await buildEntryKey('B', 'summary', 'c/1', ['y'])).not.toBe(k1)
    expect(await nameBookId('a.epub')).toMatch(/^name-[0-9a-f]{24}$/)
  })
})

describe('createLocalPipelineCache：版本化键', () => {
  it('同上下文命中；模型 / prompt / 语言 / bookType / 内容 / 自定义 prompt 变化均不命中', async () => {
    const store = freshStore()
    const c = (await createLocalPipelineCache(ctx(), store))!
    await c.setChapter('summary', ch, '摘要')
    await c.setBook('connections', 'IN', '关联')
    expect(await (await createLocalPipelineCache(ctx(), store))!.getChapter('summary', ch)).toBe('摘要')
    expect(await c.getBook('connections', 'IN')).toBe('关联')
    expect(await c.getBook('connections', 'IN2')).toBeNull()

    const variants: Array<Partial<LocalCacheContext>> = [
      { modelId: 'openai:gpt-4o-mini' },
      { outputLanguage: 'en' },
      { bookType: 'fiction' },
      { customPrompt: '自定义' },
      { promptConfig: { chapterSummary: { fiction: '', nonFiction: '我的 prompt' } } as never },
      { bookId: 'book2' },
    ]
    for (const v of variants) {
      const other = (await createLocalPipelineCache(ctx(v), store))!
      expect(await other.getChapter('summary', ch)).toBeNull()
    }
    expect(await c.getChapter('summary', { ...ch, content: ch.content + '改' })).toBeNull()
    expect(await c.getChapter('mindmap', ch)).toBeNull()
  })

  it('auto 语言按实际解析语言入键', async () => {
    const store = freshStore()
    const prev = i18n.language
    await i18n.changeLanguage('zh')
    expect(resolveOutputLanguage('auto')).toBe('zh')
    const auto = (await createLocalPipelineCache(ctx({ outputLanguage: 'auto' }), store))!
    await auto.setChapter('summary', ch, '中文摘要')
    expect(await (await createLocalPipelineCache(ctx({ outputLanguage: 'zh' }), store))!.getChapter('summary', ch)).toBe('中文摘要')
    await i18n.changeLanguage('en')
    expect(await (await createLocalPipelineCache(ctx({ outputLanguage: 'auto' }), store))!.getChapter('summary', ch)).toBeNull()
    await i18n.changeLanguage(prev)
    expect(resolveOutputLanguage('fr')).toBe('fr')
  })

  it('无 bookId 时停用缓存', async () => {
    expect(await createLocalPipelineCache(ctx({ bookId: '' }), freshStore())).toBeNull()
  })

  it('prompt 模板：自定义 > 用户配置 > 默认', () => {
    const t1 = resolvePromptTemplates(null, 'fiction', '  ')
    expect(t1.summary.length).toBeGreaterThan(10)
    const t2 = resolvePromptTemplates(
      { chapterSummary: { fiction: 'F', nonFiction: 'N' }, mindmap: { chapter: 'M', arrow: '', combined: 'C' }, connectionAnalysis: 'X', overallSummary: 'O' },
      'fiction'
    )
    expect(t2).toMatchObject({ summary: 'F', mindmap: 'M', combined_mindmap: 'C', connections: 'X', overall_summary: 'O' })
    expect(resolvePromptTemplates(null, 'non-fiction', '我的').summary).toBe('我的')
    expect(resolvePromptTemplates({ chapterSummary: { fiction: 'F', nonFiction: 'N' } } as never, 'non-fiction').summary).toBe('N')
  })
})

describe('按新键清除', () => {
  it('单章 / 某类 / 整书；图表副本按文件名清除', async () => {
    const store = freshStore()
    const c = (await createLocalPipelineCache(ctx(), store))!
    await c.setChapter('summary', ch, 's1')
    await c.setChapter('summary', { ...ch, id: 'chapter-2' }, 's2')
    await c.setBook('key_charts', 'in', charts)
    await saveChartsArtifact('a.epub', charts as never, store)
    expect(await readChartsArtifact('a.epub', store)).toMatchObject({ version: 1 })

    expect(await clearChapterEntries('book1', 'summary', 'chapter-1', store)).toBe(1)
    expect(await c.getChapter('summary', ch)).toBeNull()
    expect(await c.getChapter('summary', { ...ch, id: 'chapter-2' })).toBe('s2')
    expect(await clearChapterEntries(null, 'summary', 'chapter-2', store)).toBe(0)

    expect(await clearKindEntries('book1', 'key_charts', ['a.epub', null, 'a.epub'], store)).toBe(2)
    expect(await readChartsArtifact('a.epub', store)).toBeNull()
    expect(await clearKindEntries(null, 'connections', [], store)).toBe(0)

    await saveChartsArtifact('b.epub', charts as never, store)
    expect(await clearBookEntries('book1', ['b.epub'], store)).toBe(2)
    expect(await clearBookEntries(null, [], store)).toBe(0)
    await saveChartsArtifact(null, charts as never, store)
    expect(await readChartsArtifact(null, store)).toBeNull()
  })
})

describe('云同步与历史', () => {
  beforeEach(() => vi.clearAllMocks())

  const summary = {
    title: '书', author: '', chapters: [], connections: '', overallSummary: '', charts: charts as never,
  }

  it('syncSummaryResult：MD 异常标记失败；图表按 WebDAV 开关保存', async () => {
    autoSyncMock.syncSummary.mockRejectedValueOnce(new Error('net'))
    autoSyncMock.syncChartsJson.mockResolvedValueOnce({ success: false, error: 'quota' })
    expect(await syncSummaryResult(summary, 'a.epub', 'auto', { webdavEnabled: true, hasUsableChapters: true })).toEqual({
      mdFailed: true,
      chartsError: 'quota',
    })
    autoSyncMock.syncChartsJson.mockRejectedValueOnce(new Error('boom'))
    expect((await syncSummaryResult(summary, 'a.epub', 'auto', { webdavEnabled: true, hasUsableChapters: false })).chartsError).toBe('boom')
    expect(autoSyncMock.syncSummary).toHaveBeenCalledTimes(1)
    expect(await syncSummaryResult(summary, 'a.epub', 'auto', { webdavEnabled: false, hasUsableChapters: true })).toEqual({
      mdFailed: false,
      chartsError: null,
    })
    expect(autoSyncMock.syncChartsJson).toHaveBeenCalledTimes(2)
  })

  it('syncMindMapResult：去扩展名，返回是否失败', async () => {
    autoSyncMock.syncMindMap.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('x'))
    const mm = { title: '', author: '', chapters: [] }
    expect(await syncMindMapResult(mm, 'a.b.epub')).toBe(false)
    expect(autoSyncMock.syncMindMap.mock.calls[0][1]).toBe('a.b')
    expect(await syncMindMapResult(mm, 'a.epub')).toBe(true)
    expect(await syncMindMapResult(mm, 'a.epub')).toBe(true)
  })

  it('syncMindMapResult：autoSync 实际上传成功后才补写 manifest', async () => {
    const cfg = davConfig as Record<string, unknown>
    const mm = { title: '', author: '', chapters: [] }
    const manifest = {
      mode: 'mindmap' as const, fileName: 'a.epub', processedAt: 't', model: 'm',
      chapterCount: 2, processedChapters: 2, failedChapters: 0, isPartial: false,
    }
    webdavMock.uploadFile.mockReset()

    // autoSync 关闭：syncMindMap 返回 true 但未上传，不能写标记
    cfg.autoSync = false
    autoSyncMock.syncMindMap.mockResolvedValueOnce(true)
    expect(await syncMindMapResult(mm, 'a.epub', manifest)).toBe(false)
    expect(webdavMock.uploadFile).not.toHaveBeenCalled()

    // autoSync 开启：写到批量判定读取的同一路径
    cfg.autoSync = true
    autoSyncMock.syncMindMap.mockResolvedValueOnce(true)
    webdavMock.uploadFile.mockResolvedValueOnce({ success: true })
    expect(await syncMindMapResult(mm, 'a.epub', manifest)).toBe(false)
    expect(webdavMock.uploadFile.mock.calls[0][0]).toBe('/fr/a/a_mindmap_manifest.json')
    expect(JSON.parse(webdavMock.uploadFile.mock.calls[0][1])).toMatchObject({ mode: 'mindmap', isPartial: false })

    // 标记写失败视为同步失败
    autoSyncMock.syncMindMap.mockResolvedValueOnce(true)
    webdavMock.uploadFile.mockResolvedValueOnce({ success: false, error: 'x' })
    expect(await syncMindMapResult(mm, 'a.epub', manifest)).toBe(true)
    delete cfg.autoSync
  })

  it('uploadMindMapBundle：沿用单书目录布局，导图写成功后才写 manifest', async () => {
    webdavMock.syncFiles.mockResolvedValueOnce({ success: true })
    webdavMock.uploadFile.mockResolvedValueOnce({ success: true })
    const mm = {
      title: '书', author: '',
      chapters: [
        { id: 'c1', title: '一', content: '', mindMap: { nodeData: { id: 'r', topic: '一' } } as never, processed: true },
        { id: 'c2', title: '二', content: '', processed: false },
      ],
      combinedMindMap: { nodeData: { id: 'r', topic: '书' } } as never,
    }
    const manifest = {
      mode: 'combined-mindmap' as const, fileName: 'a.epub', processedAt: 'now', model: 'm',
      chapterCount: 2, processedChapters: 1, failedChapters: 1, isPartial: true,
    }
    expect(await uploadMindMapBundle(mm, 'a.epub', manifest)).toEqual({ success: true })
    const files = webdavMock.syncFiles.mock.calls[0][0]
    expect(files.map((f: { path: string }) => f.path)).toEqual(['a/mindmaps/a_chapter_1_mindmap.json', 'a/a_combined_mindmap.json'])
    expect(webdavMock.uploadFile.mock.calls[0][0]).toBe('/fr/a/a_mindmap_manifest.json')
    expect(JSON.parse(webdavMock.uploadFile.mock.calls[0][1])).toMatchObject({ isPartial: true })

    webdavMock.syncFiles.mockResolvedValueOnce({ success: false, error: '部分失败' })
    expect(await uploadMindMapBundle(mm, 'a.epub', manifest)).toEqual({ success: false, error: '部分失败' })
    expect(webdavMock.uploadFile).toHaveBeenCalledTimes(1)
    webdavMock.syncFiles.mockResolvedValueOnce({ success: true })
    webdavMock.uploadFile.mockResolvedValueOnce({ success: false, error: 'm' })
    expect((await uploadMindMapBundle(mm, 'a.epub', manifest)).error).toBe('m')
  })

  it('recordHistory 写入历史；store 抛错不外抛', () => {
    useProcessingHistoryStore.getState().clearLocalView()
    recordHistory({ bookTitle: '书', fileName: 'a.epub', processingMode: 'summary', model: 'm', chapterCount: 2 })
    expect(useProcessingHistoryStore.getState().records[0]).toMatchObject({ fileName: 'a.epub', chapterCount: 2 })
    const spy = vi.spyOn(useProcessingHistoryStore, 'getState').mockImplementation(() => {
      throw new Error('x')
    })
    expect(() =>
      recordHistory({ bookTitle: '书', fileName: 'b', processingMode: 'summary', model: 'm', chapterCount: 1 })
    ).not.toThrow()
    spy.mockRestore()
  })
})
