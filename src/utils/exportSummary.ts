/**
 * 书籍摘要导出（Markdown）
 */

import { metadataFormatter } from '@/services/metadataFormatter'
import { prepareMarkdownForRender } from '@/lib/markdown'
import { sanitizeFileName } from '@/utils/file'
import { triggerTextDownload } from '@/utils/download'
import type { BookSummary } from '@/hooks/useBookProcessing'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

export interface BuildSummaryMarkdownOptions {
  bookSummary: BookSummary
  /** 原始文件名（含扩展名）；无文件时可用书名 */
  fileName?: string | null
  model?: string
  chapterDetectionMode?: string
  chapterNamingMode?: 'auto' | 'numbered'
  epubTocDepth?: number
  /** 是否做渲染前清洗（默认 true） */
  prepareForRender?: boolean
}

/**
 * 根据书名/文件名生成导出基名（不含扩展名）
 */
export function getSummaryExportBaseName(
  bookSummary: BookSummary,
  fileName?: string | null
): string {
  const fromFile = fileName?.replace(/\.[^/.]+$/, '').trim()
  const raw = fromFile || bookSummary.title || 'summary'
  return sanitizeFileName(raw) || 'summary'
}

/**
 * 从 BookSummary 生成统一格式 Markdown
 * 不依赖 File 对象（历史/云缓存加载后也可导出）
 */
export function buildSummaryMarkdown(options: BuildSummaryMarkdownOptions): string {
  const {
    bookSummary,
    fileName,
    model = 'unknown',
    chapterDetectionMode = 'normal',
    chapterNamingMode = 'auto',
    epubTocDepth,
    prepareForRender = true,
  } = options

  const chapters = bookSummary.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    summary: chapter.summary || '',
  }))

  const bookData = {
    title: bookSummary.title,
    author: bookSummary.author,
    chapters,
    overallSummary: bookSummary.overallSummary,
    connections: bookSummary.connections,
    charts: bookSummary.charts
      ? (bookSummary.charts as unknown as Record<string, unknown>)
      : null,
  }

  const originalCharCount = bookSummary.chapters.reduce(
    (total, chapter) => total + (chapter.content?.length || 0),
    0
  )
  const processedCharCount = bookSummary.chapters.reduce(
    (total, chapter) => total + (chapter.summary?.length || 0),
    0
  )
  const selectedChapterIndices = bookSummary.chapters
    .map((_, index) => index + 1)
    .filter((_, index) => !!bookSummary.chapters[index]?.summary)

  const metadata: ProcessingMetadata = metadataFormatter.generate({
    fileName: fileName || `${bookSummary.title || 'summary'}.md`,
    bookTitle: bookSummary.title,
    model,
    chapterDetectionMode,
    epubTocDepth,
    selectedChapters: selectedChapterIndices,
    chapterCount: bookSummary.chapters.length,
    originalCharCount,
    processedCharCount,
  })

  let markdownContent = metadataFormatter.formatUnified(
    bookData,
    metadata,
    chapterNamingMode
  )

  if (prepareForRender) {
    markdownContent = prepareMarkdownForRender(markdownContent)
  }

  return markdownContent
}

/**
 * 下载完整摘要 Markdown
 */
export function downloadSummaryMarkdown(
  options: BuildSummaryMarkdownOptions
): { fileName: string } {
  const content = buildSummaryMarkdown(options)
  const base = getSummaryExportBaseName(options.bookSummary, options.fileName)
  const fileName = `${base}_总结.md`
  triggerTextDownload(content, fileName, 'text/markdown;charset=utf-8', true)
  return { fileName }
}
