import { describe, it, expect, vi, beforeEach } from 'vitest'

const { webdavMock } = vi.hoisted(() => ({
  webdavMock: {
    existsStatus: vi.fn(),
    getDirectoryContents: vi.fn(),
    getFileContents: vi.fn(),
    fileExists: vi.fn(),
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(),
    uploadFile: vi.fn(),
  },
}))

vi.mock('../src/services/webdavService', () => ({ webdavService: webdavMock }))
vi.mock('../src/stores/configStore', () => ({
  useConfigStore: { getState: () => ({ webdavConfig: { syncPath: '/fr', enabled: true } }) },
}))

import {
  escapeMetadataValue,
  formatAsHTMLComment,
  formatUnifiedMarkdown,
  generateMetadata,
  parseMetadataFromContent,
  parseUnifiedMarkdown,
  stripMetadataFromContent,
  unescapeMetadataValue,
} from '../src/services/metadataFormatter'
import { cloudCacheService } from '../src/services/cloudCacheService'
import { RESULT_PREFIX } from '../src/utils/resultStatus'

const baseMeta = () =>
  generateMetadata({
    fileName: 'a.epub',
    model: 'gpt-4o',
    chapterDetectionMode: 'normal',
    selectedChapters: [1, 2],
    chapterCount: 2,
    originalCharCount: 10,
    processedCharCount: 5,
  })

describe('元数据解析：只认文件头、写入转义', () => {
  it('正文中的 HTML 注释不会被当成元数据', () => {
    const content = '# 书\n\n<!--\nmodel: 伪造\n-->\n正文'
    expect(parseMetadataFromContent(content)).toBeNull()
    expect(stripMetadataFromContent(content)).toBe(content)
  })

  it('允许 BOM / 前导空白 / CRLF 的文件头', () => {
    const content = '﻿\n<!--\r\nmodel: m1\r\nisPartial: true\r\nchapterCount: 3\r\n-->\r\n\r\n# 书'
    const meta = parseMetadataFromContent(content)
    expect(meta?.model).toBe('m1')
    expect(meta?.isPartial).toBe(true)
    expect(meta?.chapterCount).toBe(3)
    expect(stripMetadataFromContent(content)).toBe('# 书')
  })

  it('值含 --> 与换行时写入转义，读回还原且不提前闭合', () => {
    expect(escapeMetadataValue('a-->b\nc')).toBe('a--&gt;b c')
    expect(unescapeMetadataValue('a--&gt;b')).toBe('a-->b')
    const meta = { ...baseMeta(), fileName: 'evil-->name.epub' }
    const comment = formatAsHTMLComment(meta)
    expect(comment.match(/-->/g)?.length).toBe(1)
    const parsed = parseMetadataFromContent(`${comment}\n\n# 书`)
    expect(parsed?.fileName).toBe('evil-->name.epub')
    expect(parsed?.costRMB).toBe(meta.costRMB)
    expect(parsed?.epubTocDepth).toBeUndefined()
  })

  it('cloudCacheService 解析委托同一实现', () => {
    const md = `${formatAsHTMLComment(baseMeta())}\n\n# 书`
    expect(cloudCacheService.parseMetadata(md)).toEqual(parseMetadataFromContent(md))
    expect(cloudCacheService.stripMetadata(md)).toBe('# 书')
  })
})

describe('formatUnifiedMarkdown：失败占位不写入并标记 isPartial', () => {
  it('剔除失败/跳过章节与失败的后处理段', () => {
    const md = formatUnifiedMarkdown(
      {
        title: '书',
        chapters: [
          { id: '1', title: '好章', summary: '内容' },
          { id: '2', title: '坏章', summary: `${RESULT_PREFIX.chapterFailed}超时` },
          { id: '3', title: '跳章', summary: `${RESULT_PREFIX.chapterSkipped}太短` },
        ],
        connections: `${RESULT_PREFIX.connectionsFailed}x`,
        overallSummary: '全书',
      },
      baseMeta()
    )
    expect(md).not.toContain('坏章')
    expect(md).not.toContain('跳章')
    expect(md).not.toContain('章节关联分析')
    const { metadata, data } = parseUnifiedMarkdown(md)
    expect(metadata?.isPartial).toBe(true)
    expect(data.chapters.map((c) => c.title)).toEqual(['好章'])
    expect(data.overallSummary).toBe('全书')
  })

  it('仅有跳过章节时不标记 isPartial；无元数据也能格式化', () => {
    const md = formatUnifiedMarkdown(
      {
        title: '书',
        chapters: [
          { id: '1', title: '好章', summary: '内容' },
          { id: '3', title: '跳章', summary: `${RESULT_PREFIX.chapterSkipped}太短` },
        ],
      },
      { ...baseMeta(), isPartial: false }
    )
    expect(parseMetadataFromContent(md)?.isPartial).toBe(false)
    expect(formatUnifiedMarkdown({ title: '书', chapters: [] })).toBe('# 书\n')
  })
})

describe('cloudCacheService 三态', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checkCacheStatus 透传 existsStatus，异常视为 unknown', async () => {
    webdavMock.existsStatus.mockResolvedValueOnce('exists')
    expect(await cloudCacheService.checkCacheStatus('a.epub')).toBe('exists')
    expect(webdavMock.existsStatus).toHaveBeenCalledWith('/fr/a-完整摘要.md')
    webdavMock.existsStatus.mockRejectedValueOnce(new Error('net'))
    expect(await cloudCacheService.checkCacheStatus('a.epub')).toBe('unknown')
  })

  it('fetchCacheFileNamesStatus：成功 / 目录不存在 / 失败', async () => {
    webdavMock.getDirectoryContents.mockResolvedValueOnce({
      success: true,
      data: [
        { type: 'file', basename: 'a-完整摘要.md' },
        { type: 'file', basename: 'a-完整摘要.json' },
        { type: 'directory', basename: 'x-完整摘要.md' },
      ],
    })
    const ok = await cloudCacheService.fetchCacheFileNamesStatus()
    expect(ok.status === 'ok' && [...ok.names]).toEqual(['a-完整摘要.md'])

    webdavMock.getDirectoryContents.mockResolvedValueOnce({ success: false, error: '404' })
    webdavMock.existsStatus.mockResolvedValueOnce('missing')
    const empty = await cloudCacheService.fetchCacheFileNamesStatus()
    expect(empty.status === 'ok' && empty.names.size).toBe(0)

    webdavMock.getDirectoryContents.mockResolvedValueOnce({ success: false, error: '401' })
    webdavMock.existsStatus.mockResolvedValueOnce('unknown')
    const unknown = await cloudCacheService.fetchCacheFileNamesStatus()
    expect(unknown).toEqual({ status: 'unknown', error: '401' })
    // 兼容旧接口：失败仍返回空集合
    webdavMock.getDirectoryContents.mockRejectedValueOnce(new Error('boom'))
    expect((await cloudCacheService.fetchCacheFileNames()).size).toBe(0)
  })
})
