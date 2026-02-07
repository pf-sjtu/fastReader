/**
 * EPUB 处理器
 * 重构后使用模块化结构
 */

import ePub, { Book, type NavItem } from '@ssshooter/epubjs'
import { SKIP_CHAPTER_KEYWORDS } from './constants'
import type Section from '@ssshooter/epubjs/types/section'
import {
  formatChapterNumber,
  cleanChapterTitle,
  extractContentByAnchorImproved
} from './epub'
import type { ChapterData, BookData, ChapterInfo, ChapterNamingMode, ChapterDetectionMode } from './epub/types'

export type { ChapterData, BookData }

export class EpubProcessor {
  private processingFiles = new Set<string>()

  async parseEpub(file: File): Promise<BookData> {
    try {
      const fileKey = `${file.name}_${file.size}_${file.lastModified}`
      if (this.processingFiles.has(fileKey)) {
        throw new Error('文件正在处理中，请稍候')
      }

      this.processingFiles.add(fileKey)
      try {
        console.log('[DEBUG] EpubProcessor.parseEpub 开始解析:', {
          fileName: file.name,
          fileSize: file.size,
          timestamp: Date.now()
        })

        const arrayBuffer = await file.arrayBuffer()

        console.log('[DEBUG] EpubProcessor.parseEpub arrayBuffer 读取完成:', {
          fileName: file.name,
          arrayBufferSize: arrayBuffer.byteLength,
          timestamp: Date.now()
        })

        const book = ePub()

        await book.open(arrayBuffer)

        console.log('[DEBUG] EpubProcessor.parseEpub book.open() 完成:', {
          fileName: file.name,
          bookPackagingTitle: book.packaging?.metadata?.title,
          timestamp: Date.now()
        })

        await book.ready

        console.log('[DEBUG] EpubProcessor.parseEpub book.ready 完成:', {
          fileName: file.name,
          bookPackagingTitle: book.packaging?.metadata?.title,
          bookPackagingCreator: book.packaging?.metadata?.creator,
          timestamp: Date.now()
        })

        const title = book.packaging?.metadata?.title || '未知标题'
        const author = book.packaging?.metadata?.creator || '未知作者'

        console.log('[DEBUG] EpubProcessor.parseEpub 返回结果:', {
          fileName: file.name,
          extractedTitle: title,
          extractedAuthor: author,
          timestamp: Date.now()
        })

        return { book, title, author }
      } finally {
        this.processingFiles.delete(fileKey)
      }
    } catch (error) {
      throw new Error(`解析EPUB文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  async extractBookData(
    file: File,
    useSmartDetection: boolean = false,
    skipNonEssentialChapters: boolean = true,
    maxSubChapterDepth: number = 0,
    chapterNamingMode: ChapterNamingMode = 'auto',
    chapterDetectionMode: ChapterDetectionMode = 'normal',
    epubTocDepth: number = 1
  ): Promise<BookData & { chapters: ChapterData[] }> {
    console.log('[DEBUG] EpubProcessor.extractBookData 开始:', {
      fileName: file.name,
      timestamp: Date.now()
    })

    const bookData = await this.parseEpub(file)

    console.log('[DEBUG] EpubProcessor.parseEpub 完成:', {
      fileName: file.name,
      bookTitle: bookData.title,
      timestamp: Date.now()
    })

    const chapters = await this.extractChapters(
      bookData.book,
      useSmartDetection,
      skipNonEssentialChapters,
      maxSubChapterDepth,
      chapterNamingMode,
      chapterDetectionMode,
      epubTocDepth
    )

    console.log('[DEBUG] EpubProcessor.extractChapters 完成:', {
      fileName: file.name,
      bookTitle: bookData.title,
      chapterCount: chapters.length,
      timestamp: Date.now()
    })

    return { ...bookData, chapters }
  }

  async extractChapters(
    book: Book,
    useSmartDetection: boolean = false,
    skipNonEssentialChapters: boolean = true,
    maxSubChapterDepth: number = 0,
    chapterNamingMode: ChapterNamingMode = 'auto',
    chapterDetectionMode: ChapterDetectionMode = 'normal',
    epubTocDepth: number = 1
  ): Promise<ChapterData[]> {
    try {
      const chapters: ChapterData[] = []

      try {
        let chapterInfos: ChapterInfo[] = []

        if (chapterDetectionMode === 'epub-toc') {
          const toc = book.navigation.toc
          const estimatedTotal = Math.max(toc.length, book.spine.spineItems.length)
          chapterInfos = await this.extractChaptersFromToc(
            book, toc, 0, epubTocDepth, chapterNamingMode, estimatedTotal, true
          )

          if (chapterInfos.length === 0) {
            chapterInfos = this.createFallbackChapterInfos(book, chapterNamingMode)
          }
        } else {
          const toc = book.navigation.toc.filter(item => !item.href.includes('#'))
          const estimatedTotal = Math.max(toc.length, book.spine.spineItems.length)
          chapterInfos = await this.extractChaptersFromToc(
            book, toc, 0, maxSubChapterDepth, chapterNamingMode, estimatedTotal
          )

          if (toc.length <= 3) {
            const fallbackChapterInfos = this.createFallbackChapterInfos(book, chapterNamingMode)
            if (fallbackChapterInfos.length >= chapterInfos.length) {
              chapterInfos = fallbackChapterInfos
            }
          }
        }

        if (chapterInfos.length > 0) {
          for (const chapterInfo of chapterInfos) {
            if (skipNonEssentialChapters && this.shouldSkipChapter(chapterInfo.title)) {
              continue
            }

            const chapterContent = await this.extractContentFromHref(book, chapterInfo.href, chapterInfo.subitems)

            if (chapterContent.trim().length > 100) {
              chapters.push({
                id: `chapter-${chapters.length + 1}`,
                title: chapterInfo.title,
                content: chapterContent,
                href: chapterInfo.href,
                tocItem: chapterInfo.tocItem,
                depth: chapterInfo.depth
              })
            }
          }
        }
      } catch (tocError) {
        console.warn('无法获取EPUB目录:', tocError)
      }

      let finalChapters = chapters
      if (chapterDetectionMode === 'smart') {
        finalChapters = this.detectChapters(chapters, true, chapterNamingMode)
      } else {
        finalChapters = this.detectChapters(chapters, useSmartDetection, chapterNamingMode)
      }

      return finalChapters
    } catch (error) {
      console.error('提取章节失败:', error)
      throw new Error(`提取章节失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  private createFallbackChapterInfos(book: Book, chapterNamingMode: ChapterNamingMode): ChapterInfo[] {
    return book.spine.spineItems.map((spineItem: Section, idx: number) => {
      const navItem: NavItem = {
        id: spineItem.idref || `spine-${idx + 1}`,
        href: spineItem.href,
        label: chapterNamingMode === 'numbered'
          ? `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章`
          : (spineItem.idref || `章节 ${idx + 1}`),
        subitems: []
      }
      return {
        title: navItem.label || `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章`,
        href: navItem.href!,
        subitems: [],
        tocItem: navItem,
        depth: 0
      }
    }).filter(item => !!item.href)
  }

  private async extractChaptersFromToc(
    book: Book,
    toc: NavItem[],
    currentDepth: number = 0,
    maxDepth: number = 0,
    chapterNamingMode: ChapterNamingMode = 'auto',
    totalChapters: number = 99,
    preserveAnchors: boolean = false
  ): Promise<ChapterInfo[]> {
    const chapterInfos: ChapterInfo[] = []

    for (const item of toc) {
      try {
        if (item.href) {
          const href = preserveAnchors ? item.href : item.href.split('#')[0]

          let chapterTitle: string
          if (chapterNamingMode === 'numbered') {
            chapterTitle = `第${formatChapterNumber(chapterInfos.length + 1, totalChapters)}章`
          } else {
            const rawTitle = item.label || `第${chapterInfos.length + 1}章`
            chapterTitle = cleanChapterTitle(rawTitle)
          }

          const chapterInfo: ChapterInfo = {
            title: chapterTitle,
            href: href,
            subitems: item.subitems,
            tocItem: item,
            depth: currentDepth
          }
          chapterInfos.push(chapterInfo)
        }

        if (item.subitems && item.subitems.length > 0 && maxDepth > 0 && currentDepth < maxDepth - 1) {
          const subChapters = await this.extractChaptersFromToc(
            book, item.subitems, currentDepth + 1, maxDepth, chapterNamingMode, totalChapters, preserveAnchors
          )
          chapterInfos.push(...subChapters)
        }
      } catch (error) {
        console.warn(`跳过章节 "${item.label}":`, error)
      }
    }

    return chapterInfos
  }

  private async extractContentFromHref(book: Book, href: string, subitems?: NavItem[]): Promise<string> {
    try {
      const [cleanHref, anchor] = href.split('#')
      let allContent = ''

      const mainContent = await this.getSingleChapterContent(book, cleanHref, anchor)
      if (mainContent) {
        allContent += mainContent
      }

      if (subitems && subitems.length > 0) {
        for (const subitem of subitems) {
          if (subitem.href) {
            const [subHref, subAnchor] = subitem.href.split('#')
            if (cleanHref === subHref) {
              continue
            }
            const subContent = await this.getSingleChapterContent(book, subHref, subAnchor)
            if (subContent) {
              allContent += '\n\n' + subContent
            }
          }
        }
      }

      return allContent
    } catch (error) {
      console.warn(`提取章节内容失败 (href: ${href}):`, error)
      return ''
    }
  }

  private async getSingleChapterContent(book: Book, href: string, anchor?: string): Promise<string> {
    try {
      let section: Section | null = null
      let spineIndex = -1
      const spineItems = book.spine.spineItems

      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i]
        const match = spineItem.href === href || spineItem.href.endsWith(href)
        if (match) {
          spineIndex = i
          section = book.spine.get(i)
          break
        }
      }

      if (!section) {
        console.warn(`无法获取章节: ${href}`)
        return ''
      }

      let chapterHTML = await section.render(book.load.bind(book))
      let textContent = this.extractTextFromXHTML(chapterHTML, anchor)
      
      // 封面-内容自动检测：如果内容为空，检查是否有 xxx_0001.xhtml 内容文件
      if (textContent.length < 100 && spineIndex >= 0 && spineIndex < spineItems.length - 1) {
        const nextSpineItem = spineItems[spineIndex + 1]
        const nextHref = nextSpineItem.href
        
        // 检查是否是 _0001.xhtml 格式的内容文件
        if (nextHref.match(/_\d+\.xhtml$/)) {
          const nextSection = book.spine.get(spineIndex + 1)
          if (nextSection) {
            const nextHTML = await nextSection.render(book.load.bind(book))
            const nextText = this.extractTextFromXHTML(nextHTML, anchor)
            
            if (nextText.length > textContent.length) {
              textContent = nextText
            }
            
            nextSection.unload()
          }
        }
      }
      
      section.unload()

      return textContent
    } catch (error) {
      console.warn(`获取单个章节内容失败 (href: ${href}):`, error)
      return ''
    }
  }

  private extractTextFromXHTML(xhtmlContent: string, anchor?: string): string {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml')

      const parseError = doc.querySelector('parsererror')
      if (parseError) {
        throw new Error('DOM解析失败')
      }

      const body = doc.querySelector('body')
      if (!body) {
        throw new Error('未找到body元素')
      }

      const scripts = body.querySelectorAll('script, style')
      scripts.forEach(el => el.remove())

      let textContent = ''

      if (anchor) {
        textContent = this.extractContentByAnchor(doc, anchor, xhtmlContent)
      }

      if (!textContent.trim()) {
        textContent = body.textContent || ''
      }

      return cleanChapterTitle(textContent)
    } catch (error) {
      return this.extractTextWithRegex(xhtmlContent, anchor)
    }
  }

  private extractContentByAnchor(doc: Document, anchor: string, originalHtml: string): string {
    try {
      const escapedAnchor = CSS.escape(anchor)

      let anchorElement: Element | null = null
      try {
        anchorElement = doc.querySelector(`[id="${escapedAnchor}"]`)
      } catch (e) { /* ignore */ }

      if (!anchorElement) {
        try {
          anchorElement = doc.querySelector(`[name="${escapedAnchor}"]`)
        } catch (e) { /* ignore */ }
      }

      if (!anchorElement) {
        try {
          anchorElement = doc.querySelector(`[id*="${escapedAnchor}"]`)
        } catch (e) { /* ignore */ }
      }

      if (!anchorElement) {
        const originalAnchorElement = doc.querySelector(`[id*="${anchor}"]`) ||
                                     doc.querySelector(`[name="${anchor}"]`)
        if (originalAnchorElement) {
          return this.extractContentFromElement(originalAnchorElement)
        }
        return ''
      }

      return extractContentByAnchorImproved(originalHtml, anchor)
    } catch (error) {
      console.warn('锚点内容提取失败:', error)
      return ''
    }
  }

  private extractContentFromElement(anchorElement: Element): string {
    let content = ''
    let currentElement: Element | null = anchorElement.nextElementSibling

    while (currentElement) {
      content += currentElement.textContent + '\n'
      currentElement = currentElement.nextElementSibling
    }

    if (!content.trim()) {
      content = anchorElement.textContent || ''
    }

    return cleanChapterTitle(content.trim())
  }

  private extractTextWithRegex(xhtmlContent: string, anchor?: string): string {
    let cleanContent = xhtmlContent
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')

    cleanContent = cleanContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    if (anchor) {
      const result = extractContentByAnchorImproved(cleanContent, anchor)
      if (result) return result
    }

    const bodyMatch = cleanContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const textContent = bodyMatch ? bodyMatch[1] : cleanContent
    return cleanChapterTitle(textContent.replace(/<[^>]*>/g, ' '))
  }

  private shouldSkipChapter(title: string): boolean {
    if (!title) return false
    return SKIP_CHAPTER_KEYWORDS.some(keyword =>
      title.toLowerCase().includes(keyword.toLowerCase())
    )
  }

  private detectChapters(chapters: ChapterData[], useSmartDetection: boolean, chapterNamingMode: ChapterNamingMode = 'auto'): ChapterData[] {
    if (!useSmartDetection) {
      return chapters
    }

    const chapterPatterns = [
      /^第[一二三四五六七八九十\d]+章[\s\S]*$/m,
      /^Chapter\s+\d+[\s\S]*$/mi,
      /^第[一二三四五六七八九十\d]+节[\s\S]*$/m,
      /^\d+\.[\s\S]*$/m,
      /^[一二三四五六七八九十]、[\s\S]*$/m
    ]

    const detectedChapters: ChapterData[] = []
    let currentChapter: ChapterData | null = null
    let chapterCount = 0

    for (const chapter of chapters) {
      const content = chapter.content.trim()
      if (content.length < 100) continue

      let isNewChapter = false
      let chapterTitle = chapter.title

      if (!chapterTitle || chapterTitle.includes('章节') || chapterTitle.includes('Chapter')) {
        for (const pattern of chapterPatterns) {
          const match = content.match(pattern)
          if (match) {
            const titleMatch = content.match(/^(.{1,100})/)
            chapterTitle = titleMatch ? titleMatch[1].trim() : `章节 ${chapterCount + 1}`
            isNewChapter = true
            break
          }
        }
      }

      if (isNewChapter || !currentChapter) {
        if (currentChapter && currentChapter.content.trim().length > 200) {
          detectedChapters.push({
            id: currentChapter.id,
            title: currentChapter.title,
            content: currentChapter.content.trim(),
            href: currentChapter.href,
            tocItem: currentChapter.tocItem,
            depth: currentChapter.depth
          })
        }

        chapterCount++
        const fallbackTitle = chapterNamingMode === 'numbered'
          ? `第${formatChapterNumber(chapterCount, chapters.length)}章`
          : `第 ${chapterCount} 章`
        currentChapter = {
          id: chapter.id || `chapter-${chapterCount}`,
          title: chapterTitle || fallbackTitle,
          content: content,
          href: chapter.href,
          tocItem: chapter.tocItem,
          depth: chapter.depth
        }
      } else {
        currentChapter.content += '\n\n' + content
      }
    }

    if (currentChapter && currentChapter.content.trim().length > 200) {
      detectedChapters.push({
        id: currentChapter.id,
        title: currentChapter.title,
        content: currentChapter.content.trim(),
        href: currentChapter.href,
        tocItem: currentChapter.tocItem,
        depth: currentChapter.depth
      })
    }

    return detectedChapters.length > 0 ? detectedChapters : chapters
  }

  async getSingleChapterHTML(book: Book, href: string): Promise<string> {
    try {
      let section: Section | null = null
      const spineItems = book.spine.spineItems

      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i]
        if (spineItem.href === href || spineItem.href.endsWith(href)) {
          section = book.spine.get(i)
          break
        }
      }

      if (!section) {
        console.warn(`无法获取章节HTML: ${href}`)
        return ''
      }

      try {
        const chapterHTML = await section.render(book.load.bind(book))
        section.unload()
        return chapterHTML || ''
      } catch (renderError) {
        console.warn(`章节渲染失败 (href: ${href}):`, renderError)
        return ''
      }
    } catch (error) {
      console.warn(`获取章节HTML失败 (href: ${href}):`, error)
      return ''
    }
  }
}
