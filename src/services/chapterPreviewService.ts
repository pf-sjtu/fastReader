import { EpubProcessor } from './epubProcessor'
import { PdfProcessor } from './pdfProcessor'
import type { ChapterData } from './epubProcessor'
import { detectBookFormat } from '../utils/file'

export class ChapterPreviewService {
  private static instance: ChapterPreviewService

  private constructor() {}

  static getInstance(): ChapterPreviewService {
    if (!ChapterPreviewService.instance) {
      ChapterPreviewService.instance = new ChapterPreviewService()
    }
    return ChapterPreviewService.instance
  }

  async previewChapters(
    file: File,
    chapterDetectionMode: 'normal' | 'smart' | 'epub-toc',
    epubTocDepth: number,
    chapterNamingMode: 'auto' | 'numbered',
    maxPreviewCount: number = 20
  ): Promise<{ title: string; preview: string }[]> {
    try {
      let chapters: ChapterData[] = []

      const format = detectBookFormat(file)
      if (format === 'epub') {
        const epubProcessor = new EpubProcessor()
        const bookData = await epubProcessor.parseEpub(file)
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
        const pdfProcessor = new PdfProcessor()
        chapters = await pdfProcessor.extractChapters(
          file,
          false, // useSmartDetection
          true,  // skipNonEssentialChapters
          0,     // maxSubChapterDepth
          chapterNamingMode,
          chapterDetectionMode,
          epubTocDepth
        )
      } else {
        return []
      }

      // 限制预览数量并生成预览文本
      const previewChapters = chapters.slice(0, maxPreviewCount).map(chapter => ({
        title: chapter.title,
        preview: this.generatePreview(chapter.content)
      }))

      return previewChapters
    } catch (error) {
      console.error('预览章节失败:', error)
      throw new Error(`预览章节失败: ${error instanceof Error ? error.message : '未知错误'}`)
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
