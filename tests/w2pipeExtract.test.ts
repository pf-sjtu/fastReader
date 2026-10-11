import { describe, it, expect, vi } from 'vitest'

const destroyed = vi.hoisted(() => [] as string[])

vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: class {
    kind = 'epub'
    destroy = vi.fn(async () => void destroyed.push('epub'))
  },
}))
vi.mock('../src/services/pdfProcessor', () => ({
  PdfProcessor: class {
    kind = 'pdf'
    destroy = vi.fn(async () => {
      throw new Error('destroy 失败')
    })
  },
}))

import { createProcessor, extractionArgs, releaseBookResources } from '../src/services/pipeline/extract'

describe('pipeline/extract', () => {
  it('按格式动态创建解析器', async () => {
    expect(await createProcessor('epub')).toMatchObject({ kind: 'epub' })
    expect(await createProcessor('pdf')).toMatchObject({ kind: 'pdf' })
  })

  it('extractionArgs 顺序与解析器签名一致', () => {
    expect(
      extractionArgs({
        useSmartDetection: true,
        skipNonEssentialChapters: false,
        maxSubChapterDepth: 2,
        chapterNamingMode: 'numbered',
        chapterDetectionMode: 'epub-toc',
        epubTocDepth: 3,
      })
    ).toEqual([true, false, 2, 'numbered', 'epub-toc', 3])
  })

  it('释放解析器与 PDF 文档；destroy 失败只记日志不抛', async () => {
    const epub = await createProcessor('epub')
    const pdfDestroy = vi.fn(async () => {
      throw new Error('pdf doc')
    })
    expect(() =>
      releaseBookResources(epub, { pdfDocument: { destroy: pdfDestroy } } as never)
    ).not.toThrow()
    const pdf = await createProcessor('pdf')
    expect(() => releaseBookResources(pdf, null)).not.toThrow()
    expect(() => releaseBookResources(null, null)).not.toThrow()
    // 同步抛错同样吞掉
    expect(() =>
      releaseBookResources({ destroy: () => { throw new Error('sync') } } as never, null)
    ).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(destroyed).toContain('epub')
    expect(pdfDestroy).toHaveBeenCalled()
  })
})
