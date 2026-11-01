/**
 * 书籍解析器的动态加载与释放（pdfjs / epubjs 不进首屏）
 */
import type { EpubProcessor, BookData as EpubBookData } from '@/services/epubProcessor'
import type { PdfProcessor, BookData as PdfBookData } from '@/services/pdfProcessor'
import type { PlainBookData } from './plainText'
import { logger } from '@/lib/logger'

export type BookProcessor = EpubProcessor | PdfProcessor
export type AnyBookData = EpubBookData | PdfBookData | PlainBookData

/** 章节识别参数（与 processingOptions 对应字段一致） */
export interface ExtractionOptions {
  useSmartDetection: boolean
  skipNonEssentialChapters: boolean
  maxSubChapterDepth: number
  chapterNamingMode: 'auto' | 'numbered'
  chapterDetectionMode: 'normal' | 'smart' | 'epub-toc'
  epubTocDepth: number
}

export function extractionArgs(o: ExtractionOptions) {
  return [
    o.useSmartDetection,
    o.skipNonEssentialChapters,
    o.maxSubChapterDepth,
    o.chapterNamingMode,
    o.chapterDetectionMode,
    o.epubTocDepth,
  ] as const
}

export async function createProcessor(format: 'epub' | 'pdf'): Promise<BookProcessor> {
  if (format === 'epub') {
    const { EpubProcessor } = await import('@/services/epubProcessor')
    return new EpubProcessor()
  }
  const { PdfProcessor } = await import('@/services/pdfProcessor')
  return new PdfProcessor()
}

/** 释放解析器与 PDF 文档（destroy 均幂等，失败只记日志） */
export function releaseBookResources(
  processor: BookProcessor | null,
  bookData: AnyBookData | null
): void {
  try {
    void Promise.resolve(processor?.destroy()).catch((e) =>
      logger.warn('[extract] 释放解析器失败:', e)
    )
    const pdfDocument = (bookData as PdfBookData | null)?.pdfDocument
    if (pdfDocument) {
      void Promise.resolve(pdfDocument.destroy()).catch((e) =>
        logger.warn('[extract] 释放 PDF 文档失败:', e)
      )
    }
  } catch (e) {
    logger.warn('[extract] 释放资源失败:', e)
  }
}
