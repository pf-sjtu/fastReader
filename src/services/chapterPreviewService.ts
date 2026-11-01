// 处理器按格式动态 import：本服务经 ConfigDialog 进入首屏，静态引入会把 pdfjs/epubjs 拖进首屏
import type { EpubProcessor, ChapterData } from './epubProcessor'
import type { PdfProcessor } from './pdfProcessor'
import { detectBookFormat, isPlainTextBook } from '../utils/file'
import { plainBookTitle, readPlainText, splitPlainText } from './pipeline/plainText'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export class ChapterPreviewService {
  private static instance: ChapterPreviewService

  private constructor() {}

  static getInstance(): ChapterPreviewService {
    if (!ChapterPreviewService.instance) {
      ChapterPreviewService.instance = new ChapterPreviewService()
    }
    return ChapterPreviewService.instance
  }

  /**
   * 预览章节。signal 触发时在各阶段之间抛 AbortError（解析本身不可中途打断），
   * 无论成功、失败或取消都会释放本次打开的 EPUB/PDF 资源。
   */
  async previewChapters(
    file: File,
    chapterDetectionMode: 'normal' | 'smart' | 'epub-toc',
    epubTocDepth: number,
    chapterNamingMode: 'auto' | 'numbered',
    maxPreviewCount: number = 20,
    signal?: AbortSignal
  ): Promise<{ title: string; preview: string }[]> {
    let processor: EpubProcessor | PdfProcessor | null = null
    try {
      throwIfAborted(signal)
      let chapters: ChapterData[] = []

      const format = detectBookFormat(file)
      if (format === 'epub') {
        const { EpubProcessor } = await import('./epubProcessor')
        throwIfAborted(signal)
        const epubProcessor = new EpubProcessor()
        processor = epubProcessor
        const bookData = await epubProcessor.parseEpub(file)
        throwIfAborted(signal)
        chapters = await epubProcessor.extractChapters(
          bookData.book,
          false, // useSmartDetection
          true,  // skipNonEssentialChapters
          0,     // maxSubChapterDepth
          chapterNamingMode,
          chapterDetectionMode,
          epubTocDepth
        )
      } else if (format === 'pdf') {
        const { PdfProcessor } = await import('./pdfProcessor')
        throwIfAborted(signal)
        const pdfProcessor = new PdfProcessor()
        processor = pdfProcessor
        chapters = await pdfProcessor.extractChapters(
          file,
          false, // useSmartDetection
          true,  // skipNonEssentialChapters
          0,     // maxSubChapterDepth
          chapterNamingMode,
          chapterDetectionMode,
          epubTocDepth
        )
      } else if (isPlainTextBook(file)) {
        // .txt / .md：没有解析器，正文就是文件本身（章节按标题切分，见 pipeline/plainText）
        const text = await readPlainText(file)
        // 空文件不返回「一章空内容」：与单本处理的 upload.emptyFile 守卫保持同一个判断
        if (!text.trim()) return []
        chapters = splitPlainText(text, plainBookTitle(file.name))
      } else {
        return []
      }
      throwIfAborted(signal)

      // 限制预览数量并生成预览文本
      return chapters.slice(0, maxPreviewCount).map(chapter => ({
        title: chapter.title,
        preview: this.generatePreview(chapter.content)
      }))
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw error
      console.error('预览章节失败:', error)
      throw new Error(`预览章节失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      await processor?.destroy()
    }
  }

  private generatePreview(content: string, maxLength: number = 20): string {
    if (!content) return ''

    // 移除多余的空白字符
    const cleanContent = content.replace(/\s+/g, ' ').trim()

    // 如果内容长度小于等于最大长度，直接返回
    if (cleanContent.length <= maxLength) {
      return cleanContent
    }

    // 截取指定长度的内容
    return cleanContent.substring(0, maxLength) + '...'
  }
}

// 导出单例实例
export const chapterPreviewService = ChapterPreviewService.getInstance()
