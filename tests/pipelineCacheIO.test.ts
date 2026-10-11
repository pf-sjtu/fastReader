import { describe, it, expect, vi, beforeEach } from 'vitest'

const { webdavMock, davConfig } = vi.hoisted(() => ({
  webdavMock: {
    existsStatus: vi.fn(),
    getDirectoryContents: vi.fn(),
    getFileContents: vi.fn(),
    fileExists: vi.fn(),
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(),
    uploadFile: vi.fn(),
  },
  davConfig: { syncPath: '/fr', enabled: true },
}))

vi.mock('../src/services/webdavService', () => ({ webdavService: webdavMock }))
vi.mock('../src/stores/configStore', () => ({
  useConfigStore: { getState: () => ({ webdavConfig: davConfig }) },
}))

import { cloudCacheService } from '../src/services/cloudCacheService'
import { CacheService } from '../src/services/cacheService'
import { formatUnifiedMarkdown, generateMetadata } from '../src/services/metadataFormatter'

const md = formatUnifiedMarkdown(
  { title: '书', author: '某人', chapters: [{ id: '1', title: '一', summary: '摘' }], overallSummary: '总' },
  generateMetadata({
    fileName: 'a.epub',
    model: 'm',
    chapterDetectionMode: 'normal',
    selectedChapters: [1],
    chapterCount: 1,
    originalCharCount: 1,
    processedCharCount: 1,
  })
)

describe('cloudCacheService 读写', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webdavMock.isInitialized.mockReturnValue(true)
    davConfig.enabled = true
  })

  it('路径规则：只去掉最后一个扩展名并去非法字符', () => {
    expect(cloudCacheService.getCacheFilePath('a:b.v2.epub')).toBe('/fr/ab.v2-完整摘要.md')
    expect(cloudCacheService.getChartsCacheFilePath('a.epub')).toBe('/fr/a-完整摘要.json')
    expect(cloudCacheService.isCachedByFileName('a.epub', new Set(['a-完整摘要.md']))).toBe(true)
  })

  it('checkCacheExists 透传 fileExists，异常为 false', async () => {
    webdavMock.fileExists.mockResolvedValueOnce(true)
    expect(await cloudCacheService.checkCacheExists('a.epub')).toBe(true)
    webdavMock.fileExists.mockRejectedValueOnce(new Error('x'))
    expect(await cloudCacheService.checkCacheExists('a.epub')).toBe(false)
  })

  it('readChartsJson：找到 / 404 / 其它错误 / 异常', async () => {
    webdavMock.getFileContents.mockResolvedValueOnce({ success: true, data: '{"a":1}' })
    expect(await cloudCacheService.readChartsJson('a.epub')).toEqual({ found: true, content: '{"a":1}' })
    webdavMock.getFileContents.mockResolvedValueOnce({ success: false, error: '404 Not Found' })
    expect((await cloudCacheService.readChartsJson('a.epub')).found).toBe(false)
    webdavMock.getFileContents.mockResolvedValueOnce({ success: false, error: '500' })
    expect((await cloudCacheService.readChartsJson('a.epub')).error).toBe('500')
    webdavMock.getFileContents.mockRejectedValueOnce(new Error('net'))
    expect((await cloudCacheService.readChartsJson('a.epub')).error).toBe('net')
  })

  it('readCache 解析元数据；MD 缺失时失败但带回图表状态', async () => {
    webdavMock.getFileContents
      .mockResolvedValueOnce({ success: true, data: md })
      .mockResolvedValueOnce({ success: false, error: '404' })
    const ok = await cloudCacheService.readCache('a.epub')
    expect(ok.success).toBe(true)
    expect(ok.metadata?.fileName).toBe('a.epub')
    expect(ok.chartsFileFound).toBe(false)

    webdavMock.getFileContents
      .mockResolvedValueOnce({ success: false, error: 'gone' })
      .mockResolvedValueOnce({ success: true, data: '{}' })
    const miss = await cloudCacheService.readCache('a.epub')
    expect(miss).toMatchObject({ success: false, error: 'gone', chartsFileFound: true })

    webdavMock.getFileContents.mockRejectedValueOnce(new Error('boom'))
    expect((await cloudCacheService.readCache('a.epub')).error).toBe('boom')
  })

  it('parseUnifiedContent 与 batchCheckCache', async () => {
    const parsed = cloudCacheService.parseUnifiedContent(md)
    expect(parsed).toMatchObject({ title: '书', author: '某人', overallSummary: '总', charts: null })
    expect(parsed.chapters).toEqual([{ title: '一', summary: '摘' }])

    const map = await cloudCacheService.batchCheckCache(['a.epub', 'b.pdf'], new Set(['a-完整摘要.md']))
    expect([...map]).toEqual([
      ['a.epub', true],
      ['b.pdf', false],
    ])
  })

  it('uploadChartsJson：空数据 / 未启用 / 初始化失败 / 上传失败 / 校验路径', async () => {
    expect((await cloudCacheService.uploadChartsJson('a.epub', null)).error).toBe('无图表数据')

    webdavMock.isInitialized.mockReturnValue(false)
    davConfig.enabled = false
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).error).toBe('WebDAV 未启用')
    davConfig.enabled = true
    webdavMock.initialize.mockResolvedValueOnce({ success: false, error: 'auth' })
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).error).toBe('auth')
    webdavMock.isInitialized.mockReturnValue(true)

    webdavMock.uploadFile.mockResolvedValueOnce({ success: false, error: 'quota' })
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).error).toBe('quota')

    webdavMock.uploadFile.mockResolvedValue({ success: true })
    webdavMock.getFileContents.mockResolvedValueOnce({ success: true, data: '{}' })
    expect(await cloudCacheService.uploadChartsJson('a.epub', {})).toEqual({
      success: true,
      path: '/fr/a-完整摘要.json',
    })

    webdavMock.getFileContents.mockResolvedValueOnce({ success: false })
    webdavMock.fileExists.mockResolvedValueOnce(true)
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).success).toBe(true)

    webdavMock.getFileContents.mockResolvedValueOnce({ success: false, error: 'stale' })
    webdavMock.fileExists.mockResolvedValueOnce(false)
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).error).toBe('stale')

    webdavMock.uploadFile.mockRejectedValueOnce(new Error('x'))
    expect((await cloudCacheService.uploadChartsJson('a.epub', {})).error).toBe('x')
  })
})

describe('CacheService 章节级读写与清除', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        },
      },
      writable: true,
      configurable: true,
    })
  })

  it('getSummary / getCache 聚合章节键；clearChapterCache 只删该章', () => {
    const cache = new CacheService()
    expect(cache.getSummary('b.epub')).toBeNull()
    cache.setCache('b.epub', 'summary', 's1', 'c1')
    cache.setCache('b.epub', 'summary', 's2', 'c2')
    cache.setCache('b.epub', 'connections', 'conn')
    expect(cache.getCache('b.epub', 'summary')).toEqual({
      chapters: [
        { id: 'c1', summary: 's1' },
        { id: 'c2', summary: 's2' },
      ],
      connections: 'conn',
      overallSummary: '',
    })
    expect(cache.getCache('b.epub', 'connections')).toBe('conn')

    expect(cache.clearChapterCache('b.epub', 'c1', 'summary')).toBe(true)
    expect(cache.getString('b.epub', 'summary', 'c1')).toBeNull()
    expect(cache.getString('b.epub', 'summary', 'c2')).toBe('s2')
    expect(cache.clearChapterCache('b.epub', 'c1', 'summary')).toBe(false)
  })

  it('思维导图章节键与整书导图；按模式清除', () => {
    const cache = new CacheService()
    const mm = { nodeData: { id: 'r', topic: 'x' } } as never
    expect(cache.getMindMapData('m.epub')).toBeNull()
    cache.setCache('m.epub', 'mindmap', mm, 'c1')
    cache.setCache('m.epub', 'combined_mindmap', mm)
    cache.setSelectedChapters('m.epub', new Set(['c1']))
    expect(cache.getSelectedChapters('m.epub')).toEqual(['c1'])
    expect(cache.getCache('m.epub', 'mindmap')).toEqual({
      chapters: [{ id: 'c1', mindMap: mm }],
      combinedMindMap: mm,
    })
    expect(cache.clearBookCache('m.epub', 'combined_mindmap')).toBeGreaterThan(0)
    expect(cache.getMindMap('m.epub', 'combined_mindmap')).toBeNull()
    expect(cache.clearSpecificCache('m.epub', 'key_charts')).toBe(false)
    expect(cache.delete('m.epub', 'mindmap', 'c1')).toBe(true)
  })
})
