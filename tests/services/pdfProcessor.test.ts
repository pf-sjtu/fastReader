import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getDocumentMock, globalWorkerOptions } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  globalWorkerOptions: { workerSrc: '' }
}))

vi.mock('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptions
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
})
