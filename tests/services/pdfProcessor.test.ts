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

import { PdfProcessor } from '../../src/services/pdfProcessor'

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
