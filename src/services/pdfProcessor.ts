import * as pdfjsLib from 'pdfjs-dist'
// 动态导入worker以避免构建错误
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString()
}
import { SKIP_CHAPTER_KEYWORDS } from './constants'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ConcurrencyLimiter } from '../utils/async'

// 格式化章节编号，支持补零
const formatChapterNumber = (index: number, total: number = 99): string => {
  // 根据总数确定位数
  const digits = total >= 100 ? 3 : 2
  return index.toString().padStart(digits, '0')
}

export interface ChapterData {
  id: string
  title: string
  content: string
  // PDF特有的页面信息
  startPage?: number
  endPage?: number
  pageIndex?: number
}

type PdfMetadataInfo = {
  Title?: string
  Author?: string
}

type PdfOutlineItem = {
  title?: string
  items?: PdfOutlineItem[]
  dest?: unknown
}

export interface BookData {
  title: string
  author: string
  totalPages: number
  // 保存PDF文档实例用于后续页面渲染
  pdfDocument?: PDFDocumentProxy
}

export class PdfProcessor {

  private extractTextFromItems(items: unknown[]): string {
    return items
      .map((item) => {
        if (item && typeof item === 'object' && 'str' in item && typeof (item as { str?: unknown }).str === 'string') {
          return (item as { str: string }).str
        }
        return ''
      })
      .join(' ')
      .trim()
  }

  private async safeDestroyPdf(pdf: PDFDocumentProxy | null | undefined, context: string): Promise<void> {
    if (!pdf) return
    try {
      await pdf.destroy()
    } catch (destroyError) {
      console.warn(`⚠️ [DEBUG] 释放PDF资源失败 (${context}):`, destroyError)
    }
  }

  async parsePdf(file: File): Promise<BookData> {
    let pdf: PDFDocumentProxy | null = null
    let keepPdfForCaller = false

    try {
      console.log('[DEBUG] PdfProcessor.parsePdf 开始解析:', {
        fileName: file.name,
        fileSize: file.size,
        timestamp: Date.now()
      })

      // 将File转换为ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()

      console.log('[DEBUG] PdfProcessor.parsePdf arrayBuffer 读取完成:', {
        fileName: file.name,
        arrayBufferSize: arrayBuffer.byteLength,
        timestamp: Date.now()
      })

      // 使用PDF.js解析PDF文件
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      console.log('[DEBUG] PdfProcessor.parsePdf pdfjsLib.getDocument 完成:', {
        fileName: file.name,
        totalPages: pdf.numPages,
        timestamp: Date.now()
      })

      // 获取PDF元数据
      const metadata = await pdf.getMetadata()
      console.log('[DEBUG] PdfProcessor.parsePdf metadata:', metadata)
      const metadataInfo = metadata.info as PdfMetadataInfo | undefined
      const title = metadataInfo?.Title || file.name.replace('.pdf', '') || '未知标题'
      const author = metadataInfo?.Author || '未知作者'

      console.log(`[DEBUG] PDF解析完成:`, {
        fileName: file.name,
        extractedTitle: title,
        extractedAuthor: author,
        totalPages: pdf.numPages
      })

      keepPdfForCaller = true
      return {
        title,
        author,
        totalPages: pdf.numPages,
        pdfDocument: pdf
      }
    } catch (error) {
      throw new Error(`解析PDF文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      if (!keepPdfForCaller) {
        await this.safeDestroyPdf(pdf, 'parsePdf')
      }
    }
  }

  async extractBookData(file: File, useSmartDetection: boolean = false, skipNonEssentialChapters: boolean = true, maxSubChapterDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', chapterDetectionMode: 'normal' | 'smart' | 'epub-toc' = 'normal', epubTocDepth: number = 1): Promise<BookData & { chapters: ChapterData[] }> {
    console.log('[DEBUG] PdfProcessor.extractBookData 开始:', {
      fileName: file.name,
      timestamp: Date.now()
    })

    const bookData = await this.parsePdf(file)

    console.log('[DEBUG] PdfProcessor.parsePdf 完成:', {
      fileName: file.name,
      bookTitle: bookData.title,
      timestamp: Date.now()
    })

    const chapters = await this.extractChapters(
      file,
      useSmartDetection,
      skipNonEssentialChapters,
      maxSubChapterDepth,
      chapterNamingMode,
      chapterDetectionMode,
      epubTocDepth,
      bookData.pdfDocument as PDFDocumentProxy | undefined
    )

    console.log('[DEBUG] PdfProcessor.extractChapters 完成:', {
      fileName: file.name,
      bookTitle: bookData.title,
      chapterCount: chapters.length,
      timestamp: Date.now()
    })

    return {
      ...bookData,
      chapters
    }
  }

  async extractChapters(file: File, useSmartDetection: boolean = false, skipNonEssentialChapters: boolean = true, maxSubChapterDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', chapterDetectionMode: 'normal' | 'smart' | 'epub-toc' = 'normal', _epubTocDepth: number = 1, existingPdf?: PDFDocumentProxy): Promise<ChapterData[]> {
    let pdf: PDFDocumentProxy | null = null
    let shouldDestroyPdf = false

    try {
      void _epubTocDepth

      if (existingPdf) {
        pdf = existingPdf
      } else {
        const arrayBuffer = await file.arrayBuffer()
        pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        shouldDestroyPdf = true
      }

      const chapters: ChapterData[] = []
      const totalPages = pdf.numPages

      console.log(`📚 [DEBUG] 开始提取PDF内容，总页数: ${totalPages}`)

      // 首先尝试使用PDF的outline（书签/目录）来获取章节
      try {
        const outline = await pdf.getOutline()
        console.log(`📚 [DEBUG] 获取到PDF目录:`, outline)
        if (outline && outline.length > 0) {
          // 获取章节信息
          // 估算总章节数，用于补零格式化
          const estimatedTotal = Math.max(outline.length, 50) // 至少估算50个章节
          const chapterInfos = await this.extractChaptersFromOutline(pdf, outline, 0, maxSubChapterDepth, chapterNamingMode, estimatedTotal)
          console.log(chapterInfos, 'chapterInfos')
          if (chapterInfos.length > 0) {
            // 根据章节信息提取内容（使用并发控制）
            const limiter = new ConcurrencyLimiter(3) // 最多3个并发

            const chapterPromises = chapterInfos.map((chapterInfo, i) => {
              return limiter.execute(async () => {
                // 检查是否需要跳过此章节
                if (skipNonEssentialChapters && this.shouldSkipChapter(chapterInfo.title)) {
                  console.log(`⏭️ [DEBUG] 跳过无关键内容章节: "${chapterInfo.title}"`)
                  return null
                }

                const nextChapterInfo = chapterInfos[i + 1]

                const startPage = chapterInfo.pageIndex + 1
                const endPage = nextChapterInfo ? nextChapterInfo.pageIndex : totalPages

                console.log(`📄 [DEBUG] 提取章节 "${chapterInfo.title}" (第${startPage}-${endPage}页)`)

                const chapterContent = await this.extractTextFromPages(pdf, startPage, endPage)

                if (chapterContent.trim().length > 100) {
                  return {
                    id: `chapter-${i + 1}`,
                    title: chapterInfo.title,
                    content: chapterContent,
                    startPage: startPage,
                    endPage: endPage,
                    pageIndex: chapterInfo.pageIndex
                  } as ChapterData
                }
                return null
              })
            })

            const results = await Promise.all(chapterPromises)
            results.forEach(result => {
              if (result) chapters.push(result)
            })
          }
        }
      } catch (outlineError) {
        console.warn(`⚠️ [DEBUG] 无法获取PDF目录:`, outlineError)
      }

      // 如果没有从outline获取到章节，使用备用方法
      if (chapters.length === 0) {
        console.log(`📖 [DEBUG] 使用备用分章节方法，智能检测: ${useSmartDetection}`)

        // 获取所有页面的文本内容（使用并发控制）
        const allPageTexts: string[] = new Array(totalPages).fill('')
        const pageLimiter = new ConcurrencyLimiter(3) // 最多3个并发页面提取

        const pagePromises = Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => {
          return pageLimiter.execute(async () => {
            console.log(`📖 [DEBUG] 处理第 ${pageNum}/${totalPages} 页`)

            try {
              const page = await pdf.getPage(pageNum)
              const textContent = await page.getTextContent()

              // 提取页面文本
              const pageText = this.extractTextFromItems(textContent.items as unknown[])

              allPageTexts[pageNum - 1] = pageText
              console.log(`📄 [DEBUG] 第${pageNum}页文本长度: ${pageText.length} 字符`)
            } catch (pageError) {
              console.warn(`❌ [DEBUG] 跳过第${pageNum}页:`, pageError)
              allPageTexts[pageNum - 1] = ''
            }
          })
        })

        await Promise.all(pagePromises)

        let detectedChapters: ChapterData[] = []

        // 根据章节识别模式决定是否使用智能检测
        const shouldUseSmartDetection = chapterDetectionMode === 'smart' || (chapterDetectionMode !== 'normal' && useSmartDetection)
        
        if (shouldUseSmartDetection) {
          console.log(`🧠 [DEBUG] 启用智能章节检测 (模式: ${chapterDetectionMode})`)
          detectedChapters = this.detectChapters(allPageTexts, chapterNamingMode)
        }

        if (detectedChapters.length === 0) {
          // 如果没有检测到章节，按页面分组
          const pagesPerChapter = Math.max(1, Math.floor(totalPages / 10)) // 每章最多10页

          for (let i = 0; i < totalPages; i += pagesPerChapter) {
            const endPage = Math.min(i + pagesPerChapter, totalPages)
            const chapterContent = allPageTexts
              .slice(i, endPage)
              .join('\n\n')
              .trim()

            if (chapterContent.length > 100) {
              chapters.push({
                id: `chapter-${Math.floor(i / pagesPerChapter) + 1}`,
                title: `第 ${Math.floor(i / pagesPerChapter) + 1} 部分 (第${i + 1}-${endPage}页)`,
                content: chapterContent,
                startPage: i + 1,
                endPage: endPage
              })
            }
          }
        } else {
          // 使用检测到的章节
          chapters.push(...detectedChapters)
        }
      }

      console.log(`📊 [DEBUG] 最终提取到 ${chapters.length} 个章节`)

      if (chapters.length === 0) {
        throw new Error('未找到有效的章节内容')
      }

      return chapters
    } catch (error) {
      console.error(`❌ [DEBUG] 提取章节失败:`, error)
      throw new Error(`提取章节失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      if (shouldDestroyPdf) {
        await this.safeDestroyPdf(pdf, 'extractChapters')
      }
    }
  }

  private async extractChaptersFromOutline(pdf: PDFDocumentProxy, outline: PdfOutlineItem[], currentDepth: number = 0, maxDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', totalChapters: number = 99): Promise<{ title: string, pageIndex: number }[]> {
    const chapterInfos: { title: string, pageIndex: number }[] = []

    for (let i = 0; i < outline.length; i++) {
      const item = outline[i]
      try {
        if (item.items && item.items.length > 0 && maxDepth > 0 && currentDepth < maxDepth) {
          const subChapters = await this.extractChaptersFromOutline(pdf, item.items, currentDepth + 1, maxDepth, chapterNamingMode, totalChapters)
          chapterInfos.push(...subChapters)
        } else if (item.dest) {
          // 根据章节命名模式生成标题
          let chapterTitle: string
          if (chapterNamingMode === 'numbered') {
            chapterTitle = `第${formatChapterNumber(chapterInfos.length + 1, totalChapters)}章`
          } else {
            chapterTitle = item.title || `第${chapterInfos.length + 1}章`
          }
          
          chapterInfos.push({
            title: chapterTitle,
            pageIndex: await this.getDestinationPageIndex(pdf, item.dest)
          })

          console.log(`📖 [DEBUG] 章节: "${item.title}" -> 第${chapterInfos[chapterInfos.length - 1].pageIndex + 1}页`)
        }
      } catch (error) {
        console.warn(`⚠️ [DEBUG] 跳过章节 "${item.title}":`, error)
      }
    }

    // 按页面索引排序
    chapterInfos.sort((a, b) => a.pageIndex - b.pageIndex)

    return chapterInfos
  }

  private async getDestinationPageIndex(pdf: PDFDocumentProxy, dest: unknown): Promise<number> {
    try {
      if (typeof dest === 'string') {
        // 如果dest是字符串，需要解析为页面引用
        const namedDest = await pdf.getDestination(dest)
        if (namedDest) {
          return await this.getDestinationPageIndex(pdf, namedDest)
        }
      } else if (Array.isArray(dest) && dest.length > 0) {
        // 如果dest是数组，第一个元素通常是页面引用
        const pageRef = dest[0]
        if (typeof pageRef === 'object' && pageRef.num !== undefined) {
          const pageIndex = await pdf.getPageIndex(pageRef)
          return pageIndex
        } else if (typeof pageRef === 'number') {
          return pageRef - 1 // PDF页面索引从0开始
        }
      }
      return 0 // 默认返回第一页
    } catch (error) {
      console.warn('获取目标页面索引失败:', error)
      return 0
    }
  }

  private async extractTextFromPages(pdf: PDFDocumentProxy, startPage: number, endPage: number): Promise<string> {
    const pageTexts: string[] = []

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()

        const pageText = this.extractTextFromItems(textContent.items as unknown[])

        if (pageText.length > 0) {
          pageTexts.push(pageText)
        }
      } catch (error) {
        console.warn(`⚠️ [DEBUG] 跳过第${pageNum}页:`, error)
      }
    }

    return pageTexts.join('\n\n')
  }

  private detectChapters(pageTexts: string[], chapterNamingMode: 'auto' | 'numbered' = 'auto'): ChapterData[] {
    const chapters: ChapterData[] = []
    const chapterPatterns = [
      /^第[一二三四五六七八九十\d]+章[\s\S]*$/m,
      /^Chapter\s+\d+[\s\S]*$/mi,
      /^第[一二三四五六七八九十\d]+节[\s\S]*$/m,
      /^\d+\.[\s\S]*$/m,
      /^[一二三四五六七八九十]、[\s\S]*$/m
    ]

    let currentChapter: { title: string; content: string; startPage: number } | null = null
    let chapterCount = 0

    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i].trim()
      if (pageText.length < 50) continue // 跳过内容太少的页面

      // 检查是否是新章节的开始
      let isNewChapter = false
      let chapterTitle = ''

      for (const pattern of chapterPatterns) {
        const match = pageText.match(pattern)
        if (match) {
          // 提取章节标题（取前100个字符作为标题）
          const titleMatch = pageText.match(/^(.{1,100})/)
          const fallbackTitle = chapterNamingMode === 'numbered' 
            ? `第${formatChapterNumber(chapterCount + 1, pageTexts.length)}章`
            : `章节 ${chapterCount + 1}`
          chapterTitle = titleMatch ? titleMatch[1].trim() : fallbackTitle
          isNewChapter = true
          break
        }
      }

      if (isNewChapter) {
        // 保存上一个章节
        if (currentChapter && currentChapter.content.trim().length > 200) {
          chapters.push({
            id: `chapter-${chapterCount}`,
            title: currentChapter.title,
            content: currentChapter.content.trim(),
            startPage: currentChapter.startPage
          })
        }

        // 开始新章节
        chapterCount++
        currentChapter = {
          title: chapterTitle,
          content: pageText,
          startPage: i + 1
        }

        console.log(`📖 [DEBUG] 检测到新章节: "${chapterTitle}" (第${i + 1}页)`)
      } else if (currentChapter) {
        // 添加到当前章节
        currentChapter.content += '\n\n' + pageText
      } else {
        // 如果还没有章节，创建第一个章节
        chapterCount++
        currentChapter = {
          title: `第 ${chapterCount} 章`,
          content: pageText,
          startPage: i + 1
        }
      }
    }

    // 保存最后一个章节
    if (currentChapter && currentChapter.content.trim().length > 200) {
      chapters.push({
        id: `chapter-${chapterCount}`,
        title: currentChapter.title,
        content: currentChapter.content.trim(),
        startPage: currentChapter.startPage
      })
    }

    console.log(`🔍 [DEBUG] 章节检测完成，找到 ${chapters.length} 个章节`)

    return chapters
  }

  // 检查是否应该跳过某个章节
  private shouldSkipChapter(title: string): boolean {
    const normalizedTitle = title.toLowerCase().trim()
    return SKIP_CHAPTER_KEYWORDS.some(keyword =>
      normalizedTitle.includes(keyword.toLowerCase())
    )
  }

  // 新增方法：获取PDF页面的渲染内容（用于阅读器显示）
  async getPageContent(pdfDocument: PDFDocumentProxy, pageNumber: number): Promise<{ textContent: string; canvas?: HTMLCanvasElement }> {
    try {
      const page = await pdfDocument.getPage(pageNumber)

      // 获取文本内容
      const textContent = await page.getTextContent()
      const pageText = this.extractTextFromItems(textContent.items as unknown[])

      // 创建canvas用于渲染PDF页面
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      canvas.height = viewport.height
      canvas.width = viewport.width

      if (context) {
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }
        await page.render(renderContext).promise
      }

      return {
        textContent: pageText,
        canvas: canvas
      }
    } catch (error) {
      console.warn(`❌ [DEBUG] 获取页面内容失败 (页面 ${pageNumber}):`, error)
      return { textContent: '' }
    }
  }

  // 新增方法：获取章节的所有页面内容（用于阅读器显示）
  async getChapterPages(pdfDocument: PDFDocumentProxy, chapter: ChapterData): Promise<{ textContent: string; canvas?: HTMLCanvasElement }[]> {
    const pages: { textContent: string; canvas?: HTMLCanvasElement }[] = []

    if (!chapter.startPage || !chapter.endPage) {
      return pages
    }

    for (let pageNum = chapter.startPage; pageNum <= chapter.endPage; pageNum++) {
      const pageContent = await this.getPageContent(pdfDocument, pageNum)
      pages.push(pageContent)
    }

    return pages
  }
}