import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getDocumentMock, globalWorkerOptions, loggerMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  globalWorkerOptions: { workerSrc: '' },
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptions
}))

vi.mock('../../src/lib/logger', () => ({
  logger: loggerMock,
}))

import { PdfProcessor, PDF_PAGES_PER_GROUP } from '../../src/services/pdfProcessor'

describe('PdfProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    if (typeof File !== 'undefined' && !('arrayBuffer' in File.prototype)) {
      Object.defineProperty(File.prototype, 'arrayBuffer', {
        value: vi.fn(function (this: File) {
          return Promise.resolve(new ArrayBuffer(this.size || 0))
        }),
        configurable: true
      })
    }
  })

  it('extractBookData 应只读取一次文件并复用已解析 PDF 实例', async () => {
    const processor = new PdfProcessor()
    const file = new File(['pdf-content'], 'sample.pdf', { type: 'application/pdf' })
    const arrayBufferSpy = vi
      .spyOn(File.prototype, 'arrayBuffer')
      .mockResolvedValue(new ArrayBuffer(16))

    const pdfMock = {
      numPages: 2,
      getMetadata: vi.fn().mockResolvedValue({ info: { Title: '示例书', Author: '作者A' } }),
      destroy: vi.fn()
    }

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })

    const extractChaptersSpy = vi
      .spyOn(processor, 'extractChapters')
      .mockResolvedValue([
        { id: 'chapter-1', title: '第一章', content: '内容A' }
      ])

    const result = await processor.extractBookData(file)

    expect(arrayBufferSpy).toHaveBeenCalledTimes(1)
    expect(getDocumentMock).toHaveBeenCalledTimes(1)
    expect(extractChaptersSpy).toHaveBeenCalledTimes(1)
    expect(extractChaptersSpy.mock.calls[0][7]).toBe(pdfMock)
    expect(result.title).toBe('示例书')
    expect(result.author).toBe('作者A')
    expect(result.chapters).toHaveLength(1)
  })

  it('parsePdf 失败时应包装错误并清理 PDF 资源', async () => {
    const processor = new PdfProcessor()
    const file = new File(['pdf-content'], 'broken.pdf', { type: 'application/pdf' })
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8))

    const pdfMock = {
      numPages: 1,
      getMetadata: vi.fn().mockRejectedValue(new Error('metadata boom')),
      destroy: vi.fn().mockResolvedValue(undefined)
    }

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })

    await expect(processor.parsePdf(file)).rejects.toThrow('解析PDF文件失败: metadata boom')
    expect(pdfMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('文本提取应安全忽略非法 text items', () => {
    const processor = new PdfProcessor()

    const processorWithInternals = processor as unknown as {
      extractTextFromItems: (items: unknown[]) => string
    }
    const text = processorWithInternals.extractTextFromItems([
      { str: 'Hello' },
      { str: 123 },
      null,
      undefined,
      { other: 'value' },
      { str: 'World' }
    ])

    expect(text).not.toContain('123')
    expect(text.replace(/\s+/g, ' ').trim()).toBe('Hello World')
  })

  it('非 debug 路径不得向 console.log 刷 [DEBUG] 或大对象 dump', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const processor = new PdfProcessor()
    const file = new File(['pdf-content'], 'sample.pdf', { type: 'application/pdf' })
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(16))

    const metadata = { info: { Title: '示例书', Author: '作者A' } }
    const outline = [{ title: '第一章', dest: [1], items: [] }]
    const pdfMock = {
      numPages: 1,
      getMetadata: vi.fn().mockResolvedValue(metadata),
      getOutline: vi.fn().mockResolvedValue(outline),
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({
          items: [{ str: 'x'.repeat(120) }],
        }),
        cleanup: vi.fn(),
      }),
      destroy: vi.fn(),
    }

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })

    await processor.extractBookData(file)

    const debugConsoleCalls = logSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          (typeof arg === 'string' && arg.includes('[DEBUG]')) ||
          arg === 'chapterInfos' ||
          arg === metadata ||
          arg === outline
      )
    )

    expect(debugConsoleCalls).toHaveLength(0)
    expect(loggerMock.debug).toHaveBeenCalled()
    expect(loggerMock.debug).toHaveBeenCalledWith(
      '[DEBUG] PdfProcessor.parsePdf metadata:',
      metadata
    )
    expect(loggerMock.debug).toHaveBeenCalledWith(
      '📚 [DEBUG] 获取到PDF目录:',
      outline
    )
    expect(
      loggerMock.debug.mock.calls.some((args) => args.includes('chapterInfos'))
    ).toBe(true)

    logSpy.mockRestore()
  })

  it('章节提取失败时仍记录 error 日志', async () => {
    const processor = new PdfProcessor()
    const file = new File(['pdf-content'], 'empty.pdf', { type: 'application/pdf' })
    const pdfMock = {
      numPages: 1,
      getOutline: vi.fn().mockRejectedValue(new Error('no outline')),
      getPage: vi.fn().mockRejectedValue(new Error('no page')),
      destroy: vi.fn(),
    }

    await expect(
      processor.extractChapters(file, false, true, 0, 'auto', 'normal', 1, pdfMock as never)
    ).rejects.toThrow('提取章节失败')

    expect(loggerMock.error).toHaveBeenCalled()
    expect(
      loggerMock.error.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('提取章节失败'))
      )
    ).toBe(true)
  })
})

describe('PdfProcessor 分组、资源释放与 worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makePage(text: string) {
    return {
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: text }] }),
      cleanup: vi.fn(),
    }
  }

  it('worker 指向 Vite 产出的 .mjs 资源 URL', () => {
    expect(globalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.min\.mjs/)
  })

  it('无目录时按固定每组最多 PDF_PAGES_PER_GROUP 页分组（1000 页不会变成每章 100 页）', async () => {
    const totalPages = 25
    const pages = Array.from({ length: totalPages }, (_, i) => makePage(`第${i + 1}页 ` + 'x'.repeat(30)))
    const pdfMock = {
      numPages: totalPages,
      getOutline: vi.fn().mockResolvedValue([]),
      getPage: vi.fn((n: number) => Promise.resolve(pages[n - 1])),
      destroy: vi.fn(),
    }
    const processor = new PdfProcessor()
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const chapters = await processor.extractChapters(file, false, true, 0, 'auto', 'normal', 1, pdfMock as never)

    expect(PDF_PAGES_PER_GROUP).toBe(10)
    expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
      [1, 10],
      [11, 20],
      [21, 25],
    ])
    expect(pages.every((p) => p.cleanup.mock.calls.length === 1)).toBe(true)
    // 调用方传入的 PDF 不由 extractChapters 释放
    expect(pdfMock.destroy).not.toHaveBeenCalled()
  })

  it('按目录提取时每页用完调用 page.cleanup()', async () => {
    const pages = [makePage('a'.repeat(80)), makePage('b'.repeat(80)), makePage('c'.repeat(80))]
    const pdfMock = {
      numPages: 3,
      getOutline: vi.fn().mockResolvedValue([{ title: '第一章', dest: [1], items: [] }]),
      getPage: vi.fn((n: number) => Promise.resolve(pages[n - 1])),
      destroy: vi.fn(),
    }
    const processor = new PdfProcessor()
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const chapters = await processor.extractChapters(file, false, true, 0, 'auto', 'normal', 1, pdfMock as never)
    expect(chapters).toHaveLength(1)
    expect(pages.every((p) => p.cleanup.mock.calls.length === 1)).toBe(true)
  })

  it('自行打开的 PDF 在 extractChapters 结束后释放', async () => {
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8))
    const pdfMock = {
      numPages: 1,
      getOutline: vi.fn().mockResolvedValue([]),
      getPage: vi.fn().mockResolvedValue(makePage('z'.repeat(200))),
      destroy: vi.fn().mockResolvedValue(undefined),
    }
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })
    const chapters = await new PdfProcessor().extractChapters(new File(['x'], 'a.pdf'))
    expect(chapters).toHaveLength(1)
    expect(pdfMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroy() 释放 parsePdf 交出的文档且幂等', async () => {
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8))
    const pdfMock = {
      numPages: 1,
      getMetadata: vi.fn().mockResolvedValue({ info: {} }),
      destroy: vi.fn().mockResolvedValue(undefined),
    }
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })
    const processor = new PdfProcessor()
    const data = await processor.parsePdf(new File(['x'], 'book.pdf'))
    expect(data.title).toBe('book')
    expect(pdfMock.destroy).not.toHaveBeenCalled()

    await processor.destroy()
    await processor.destroy()
    expect(pdfMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroy 失败只记录警告', async () => {
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8))
    const pdfMock = {
      numPages: 1,
      getMetadata: vi.fn().mockResolvedValue({ info: {} }),
      destroy: vi.fn().mockRejectedValue(new Error('x')),
    }
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(pdfMock) })
    const processor = new PdfProcessor()
    await processor.parsePdf(new File(['x'], 'book.pdf'))
    await expect(processor.destroy()).resolves.toBeUndefined()
    expect(loggerMock.warn).toHaveBeenCalled()
  })
})

describe('PdfProcessor 章节识别', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const page = (text: string) => ({
    getTextContent: vi.fn().mockResolvedValue({ items: [{ str: text }] }),
    cleanup: vi.fn(),
    getViewport: vi.fn().mockReturnValue({ width: 10, height: 20 }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  })

  it('smart 模式按「第X章」检测章节', async () => {
    const body = '正文'.repeat(120)
    const pages = [
      page('前言内容' + 'y'.repeat(60)),
      page('第一章 开始\n' + body),
      page(body),
      page('第二章 继续\n' + body),
    ]
    const pdfMock = {
      numPages: pages.length,
      getOutline: vi.fn().mockResolvedValue(null),
      getPage: vi.fn((n: number) => Promise.resolve(pages[n - 1])),
    }
    const chapters = await new PdfProcessor().extractChapters(
      new File(['x'], 'a.pdf'), true, true, 0, 'numbered', 'smart', 1, pdfMock as never
    )
    expect(chapters.map((c) => c.startPage)).toEqual([2, 4])
    expect(chapters[0].title.startsWith('第一章')).toBe(true)
    expect(chapters[0].content).toContain(body)
  })

  it('目录：命名目标、页码目标、嵌套层级、跳过非正文章节', async () => {
    const text = 'k'.repeat(150)
    const pages = Array.from({ length: 6 }, () => page(text))
    const outline = [
      { title: '版权页', dest: [1] },
      { title: '第一部', items: [{ title: '1.1', dest: 'named-a' }, { title: '1.2', dest: [{ num: 9 }] }] },
      { title: '第二章', dest: [5] },
    ]
    const pdfMock = {
      numPages: 6,
      getOutline: vi.fn().mockResolvedValue(outline),
      getDestination: vi.fn().mockResolvedValue([2]),
      getPageIndex: vi.fn().mockResolvedValue(3),
      getPage: vi.fn((n: number) => Promise.resolve(pages[n - 1])),
    }
    const chapters = await new PdfProcessor().extractChapters(
      new File(['x'], 'a.pdf'), false, true, 1, 'auto', 'normal', 1, pdfMock as never
    )
    expect(chapters.map((c) => c.title)).toEqual(['1.1', '1.2', '第二章'])
    expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([[2, 3], [4, 4], [5, 6]])
    expect(pdfMock.getDestination).toHaveBeenCalledWith('named-a')
  })

  it('getChapterPages 逐页获取文本；无页码返回空', async () => {
    const pdfDoc = { getPage: vi.fn().mockResolvedValue(page('页文本')) }
    const processor = new PdfProcessor()
    const pages = await processor.getChapterPages(pdfDoc as never, { id: '1', title: 't', content: '', startPage: 1, endPage: 2 })
    expect(pages).toHaveLength(2)
    expect(pages[0].textContent).toBe('页文本')
    await expect(processor.getChapterPages(pdfDoc as never, { id: '1', title: 't', content: '' })).resolves.toEqual([])

    pdfDoc.getPage.mockRejectedValueOnce(new Error('bad'))
    await expect(processor.getPageContent(pdfDoc as never, 9)).resolves.toEqual({ textContent: '' })
  })
})
