/**
 * 章节旁路云存档：纯函数（构建 / 解析 / 还原）+ 真实 cloudCacheService/buildCloudBook（只 mock WebDAV 边界）
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { webdavMock, davConfig } = vi.hoisted(() => ({
  webdavMock: {
    getFileContents: vi.fn(),
    existsStatus: vi.fn(),
    uploadFile: vi.fn(),
  },
  davConfig: { syncPath: '/fr', enabled: true },
}))

vi.mock('../src/services/webdavService', () => ({ webdavService: webdavMock }))
vi.mock('../src/stores/configStore', () => ({
  useConfigStore: { getState: () => ({ webdavConfig: davConfig }) },
}))

import { applyMetaSidecar, buildMetaSidecar, parseMetaSidecar } from '../src/services/pipeline/metaSidecar'
import { buildCloudBook } from '../src/services/pipeline/cloudLoad'
import { cloudCacheService } from '../src/services/cloudCacheService'
import { formatUnifiedMarkdown, generateMetadata } from '../src/services/metadataFormatter'
import type { ChapterMeta } from '../src/services/prompts/chapterMeta'

const meta = (name: string, aliases: string[] = []): ChapterMeta => ({
  oneLine: `${name}一句话`,
  takeaways: [],
  entities: [{ name, aliases }],
  terms: [],
})

const ch = (title: string, m?: ChapterMeta) => ({ title, meta: m })

describe('buildMetaSidecar', () => {
  it('没有任何章节带旁路 → null（不写空文件）', () => {
    expect(buildMetaSidecar([ch('一'), ch('二')])).toBeNull()
  })

  it('只收带旁路的章节，序号取原位置，count 为章节总数', () => {
    const s = buildMetaSidecar([ch('一'), ch('二', meta('KKR', ['Kohlberg'])), ch('三')])!
    expect(s.count).toBe(3)
    expect(s.chapters.map((c) => [c.index, c.title])).toEqual([[1, '二']])
  })
})

describe('parseMetaSidecar', () => {
  it('往返无损', () => {
    const s = buildMetaSidecar([ch('一', meta('KKR', ['Kohlberg']))])!
    expect(parseMetaSidecar(JSON.stringify(s))).toEqual(s)
  })

  it.each([
    ['空', ''],
    ['null', null],
    ['坏 JSON', '{oops'],
    ['数组', '[]'],
    ['版本不认识', JSON.stringify({ version: 99, count: 1, chapters: [] })],
    ['chapters 不是数组', JSON.stringify({ version: 1, count: 1, chapters: {} })],
  ])('%s → null（不抛）', (_n, text) => {
    expect(parseMetaSidecar(text as string | null)).toBeNull()
  })

  it('逐条清洗：meta 缺失 / 序号非法的条目被丢，其余保留；别名超长被截断', () => {
    const long = 'x'.repeat(200)
    const s = parseMetaSidecar(
      JSON.stringify({
        version: 1,
        count: 3,
        chapters: [
          { index: 0, title: 'a', meta: { oneLine: 'ok', takeaways: [], entities: [{ name: 'N', aliases: [long] }], terms: [] } },
          { index: -1, title: 'b', meta: meta('Z') },
          { index: 1, title: 'c' },
          { index: 2, title: 'd', meta: { oneLine: '', takeaways: [], entities: [], terms: [] } },
        ],
      })
    )!
    expect(s.chapters.map((c) => c.index)).toEqual([0])
    expect(s.chapters[0].meta.entities[0].aliases[0].length).toBeLessThanOrEqual(60)
  })
})

describe('applyMetaSidecar', () => {
  const sidecar = buildMetaSidecar([ch('第一章 起点', meta('A')), ch('第二章 转折'), ch('第三章 终局', meta('C'))])!

  it('章节数一致 → 按序号对位，不看标题（命名模式改过标题也能还原）', () => {
    const out = applyMetaSidecar([{ title: '章 1' }, { title: '章 2' }, { title: '章 3' }] as ReturnType<typeof ch>[], sidecar)
    expect(out.map((c) => c.meta?.entities[0].name)).toEqual(['A', undefined, 'C'])
  })

  it('章节数不一致 → 序号对上且标题兼容才挂，其余不挂', () => {
    const out = applyMetaSidecar([ch('起点'), ch('完全无关'), ch('第三章 终局'), ch('新增')], sidecar)
    // 第 0 项：序号 0 的旁路标题「第一章 起点」包含「起点」→ 挂；第 2 项标题相同 → 挂
    expect(out.map((c) => c.meta?.entities[0].name)).toEqual(['A', undefined, 'C', undefined])
    const mismatch = applyMetaSidecar([ch('别的书'), ch('别的'), ch('别的章'), ch('别的')], sidecar)
    expect(mismatch.every((c) => !c.meta)).toBe(true)
  })

  it('已有 meta 的章节不被覆盖；无旁路时原样返回', () => {
    const own = meta('OWN')
    const out = applyMetaSidecar([ch('一', own), ch('二'), ch('三')], sidecar)
    expect(out[0].meta).toBe(own)
    const same = [ch('x')]
    expect(applyMetaSidecar(same, null)).toEqual(same)
  })
})

describe('cloudCacheService 旁路读写（真实实现 + mock WebDAV）', () => {
  beforeEach(() => {
    webdavMock.getFileContents.mockReset()
    webdavMock.uploadFile.mockReset()
    webdavMock.existsStatus.mockReset()
  })

  it('路径与 MD/图表 JSON 同目录同名，扩展名 .meta.json', () => {
    expect(cloudCacheService.getMetaCacheFilePath('书.epub')).toBe('/fr/书-完整摘要.meta.json')
    expect(cloudCacheService.getChartsCacheFilePath('书.epub')).toBe('/fr/书-完整摘要.json')
  })

  it('readMetaJson：成功返回文本；404 / 失败 / 抛异常 → null', async () => {
    webdavMock.getFileContents.mockResolvedValueOnce({ success: true, data: '{"a":1}' })
    expect(await cloudCacheService.readMetaJson('书.epub')).toBe('{"a":1}')
    webdavMock.getFileContents.mockResolvedValueOnce({ success: false, error: '404 Not Found' })
    expect(await cloudCacheService.readMetaJson('书.epub')).toBeNull()
    webdavMock.getFileContents.mockRejectedValueOnce(new Error('net'))
    expect(await cloudCacheService.readMetaJson('书.epub')).toBeNull()
  })

  it('uploadMetaJson：写到旁路路径；失败返回 error 而不抛', async () => {
    webdavMock.uploadFile.mockResolvedValueOnce({ success: true })
    const ok = await cloudCacheService.uploadMetaJson('书.epub', { version: 1 })
    expect(ok).toEqual({ success: true, path: '/fr/书-完整摘要.meta.json' })
    expect(webdavMock.uploadFile).toHaveBeenCalledWith('/fr/书-完整摘要.meta.json', '{"version":1}')
    webdavMock.uploadFile.mockResolvedValueOnce({ success: false, error: '403' })
    expect((await cloudCacheService.uploadMetaJson('书.epub', {})).success).toBe(false)
    webdavMock.uploadFile.mockRejectedValueOnce(new Error('boom'))
    expect((await cloudCacheService.uploadMetaJson('书.epub', {})).error).toBe('boom')
  })
})

describe('buildCloudBook 还原旁路', () => {
  const md = formatUnifiedMarkdown(
    {
      title: '书',
      author: '某人',
      chapters: [
        { id: 'a', title: '第一章', summary: '正文一' },
        { id: 'b', title: '第二章', summary: '正文二' },
      ],
      overallSummary: '总述',
      connections: '关联',
      charts: null,
    },
    generateMetadata({
      fileName: 'a.epub',
      model: 'm',
      chapterDetectionMode: 'normal',
      selectedChapters: [1, 2],
      chapterCount: 2,
      originalCharCount: 10,
      processedCharCount: 5,
    }),
    'auto'
  )
  const opts = { fileName: 'a.epub', fallbackTitle: '书', idPrefix: 'cloud' }
  const sidecar = JSON.stringify(buildMetaSidecar([ch('第一章', meta('KKR', ['Kohlberg Kravis Roberts'])), ch('第二章')]))

  beforeEach(() => {
    webdavMock.getFileContents.mockReset()
  })

  it('快照没带 metaJson → 现读云端旁路并挂到对应章节', async () => {
    webdavMock.getFileContents.mockResolvedValue({ success: true, data: sidecar })
    const book = await buildCloudBook({ content: md }, opts)
    expect(webdavMock.getFileContents).toHaveBeenCalledWith('/fr/书-完整摘要.meta.json'.replace('书', 'a'), 'text')
    expect(book!.summary.chapters[0].meta?.entities[0].aliases).toEqual(['Kohlberg Kravis Roberts'])
    expect(book!.summary.chapters[1].meta).toBeUndefined()
  })

  it('快照带了 metaJson → 直接用，不再读 WebDAV', async () => {
    const book = await buildCloudBook({ content: md, metaJson: sidecar }, opts)
    expect(webdavMock.getFileContents).not.toHaveBeenCalled()
    expect(book!.summary.chapters[0].meta?.entities[0].name).toBe('KKR')
  })

  it('旁路缺失 / 读失败 / 损坏 → 正常加载，只是没有 meta', async () => {
    for (const reply of [
      { success: false, error: '404 Not Found' },
      { success: true, data: '{坏' },
    ]) {
      webdavMock.getFileContents.mockResolvedValue(reply)
      const book = await buildCloudBook({ content: md }, opts)
      expect(book!.summary.chapters).toHaveLength(2)
      expect(book!.summary.chapters.every((c: { meta?: unknown }) => !c.meta)).toBe(true)
    }
    webdavMock.getFileContents.mockRejectedValue(new Error('net'))
    expect((await buildCloudBook({ content: md }, opts))!.summary.chapters).toHaveLength(2)
  })

  it('没有 fileName 时不读云端', async () => {
    const book = await buildCloudBook({ content: md }, { ...opts, fileName: null })
    expect(webdavMock.getFileContents).not.toHaveBeenCalled()
    expect(book!.summary.chapters.every((c: { meta?: unknown }) => !c.meta)).toBe(true)
  })
})
