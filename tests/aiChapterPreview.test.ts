import { describe, it, expect, vi, beforeEach } from 'vitest'

const { epubMock, pdfMock } = vi.hoisted(() => ({
  epubMock: {
    parseEpub: vi.fn(),
    extractChapters: vi.fn(),
    destroy: vi.fn(),
  },
  pdfMock: {
    extractChapters: vi.fn(),
    destroy: vi.fn(),
  },
}))

vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: vi.fn(function () {
    return epubMock
  }),
}))
vi.mock('../src/services/pdfProcessor', () => ({
  PdfProcessor: vi.fn(function () {
    return pdfMock
  }),
}))

import { chapterPreviewService } from '../src/services/chapterPreviewService'

const epubFile = { name: 'a.EPUB', type: '' } as File
const pdfFile = { name: 'a.pdf', type: '' } as File

describe('chapterPreviewService.previewChapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    epubMock.parseEpub.mockResolvedValue({ book: {}, title: 't', author: 'a' })
    epubMock.extractChapters.mockResolvedValue([
      { id: '1', title: '第一章', content: '一二三四五六七八九十一二三四五六七八九十甲乙' },
      { id: '2', title: '第二章', content: '短' },
    ])
    pdfMock.extractChapters.mockResolvedValue([{ id: '1', title: 'P1', content: 'x' }])
  })

  it('EPUB：生成预览并在结束后 destroy', async () => {
    const r = await chapterPreviewService.previewChapters(epubFile, 'normal', 1, 'auto')
    expect(r).toEqual([
      { title: '第一章', preview: '一二三四五六七八九十一二三四五六七八九十...' },
      { title: '第二章', preview: '短' },
    ])
    expect(epubMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('PDF：限制数量并 destroy', async () => {
    const r = await chapterPreviewService.previewChapters(pdfFile, 'normal', 1, 'auto', 0)
    expect(r).toEqual([])
    expect(pdfMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('纯文本（.txt/.md）：没有解析器，正文就是文件本身', async () => {
    const r = await chapterPreviewService.previewChapters(
      new File(['# 一\n正文一\n# 二\n正文二'], 'notes.md', { type: 'text/markdown' }),
      'normal',
      1,
      'auto'
    )
    expect(r).toEqual([
      { title: '一', preview: '正文一' },
      { title: '二', preview: '正文二' },
    ])
  })

  it('不支持的格式返回空数组', async () => {
    await expect(
      chapterPreviewService.previewChapters({ name: 'a.mobi', type: '' } as File, 'normal', 1, 'auto')
    ).resolves.toEqual([])
  })

  it('解析失败时包装错误且仍释放资源', async () => {
    epubMock.extractChapters.mockRejectedValue(new Error('坏书'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(chapterPreviewService.previewChapters(epubFile, 'normal', 1, 'auto')).rejects.toThrow(
      '预览章节失败: 坏书'
    )
    expect(epubMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('signal 已取消：抛 AbortError，不解析', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      chapterPreviewService.previewChapters(epubFile, 'normal', 1, 'auto', 20, ctrl.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(epubMock.parseEpub).not.toHaveBeenCalled()
  })

  it('解析中途取消：抛 AbortError（不包装）并释放资源', async () => {
    const ctrl = new AbortController()
    epubMock.parseEpub.mockImplementation(async () => {
      ctrl.abort()
      return { book: {}, title: 't', author: 'a' }
    })
    await expect(
      chapterPreviewService.previewChapters(epubFile, 'normal', 1, 'auto', 20, ctrl.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(epubMock.extractChapters).not.toHaveBeenCalled()
    expect(epubMock.destroy).toHaveBeenCalledTimes(1)
  })
})
