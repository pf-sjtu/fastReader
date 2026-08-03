/**
 * EPUB 处理器
 * 重构后使用模块化结构
 */

import ePub, { Book, type NavItem } from '@ssshooter/epubjs'
import { matchesSkipChapterTitle } from './constants'
import type Section from '@ssshooter/epubjs/types/section'
import {
  formatChapterNumber,
  cleanChapterTitle,
  cleanAndFormatText,
  extractContentByAnchorImproved,
  asHrefString,
  normalizeHref,
  hrefMatches,
} from './epub'
import type { ChapterData, BookData, ChapterInfo, ChapterNamingMode, ChapterDetectionMode } from './epub/types'
import { ConcurrencyLimiter } from '../utils/async'

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
        const arrayBuffer = await file.arrayBuffer()
        const book = ePub()
        await book.open(arrayBuffer)
        await book.ready

        const title = book.packaging?.metadata?.title || '未知标题'
        const author = book.packaging?.metadata?.creator || '未知作者'

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
    const bookData = await this.parseEpub(file)

    const chapters = await this.extractChapters(
      bookData.book,
      useSmartDetection,
      skipNonEssentialChapters,
      maxSubChapterDepth,
      chapterNamingMode,
      chapterDetectionMode,
      epubTocDepth
    )

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

        // 确保 navigation 已加载（部分 epubjs 版本 ready 后 navigation 仍需 await）
        const navigation =
          book.navigation ??
          (await book.loaded?.navigation?.catch?.(() => null)) ??
          { toc: [] as NavItem[] }
        const toc: NavItem[] = Array.isArray(navigation.toc) ? navigation.toc : []
        const spineItems = book.spine?.spineItems ?? []

        if (chapterDetectionMode === 'epub-toc') {
          const estimatedTotal = Math.max(toc.length, spineItems.length)
          // 收集所有层级的章节信息
          chapterInfos = await this.extractChaptersFromToc(
            book, toc, 0, epubTocDepth, chapterNamingMode, estimatedTotal, true
          )

          // 精确层级过滤：仅保留目标层级的章节
          const targetDepth = Math.max(0, epubTocDepth - 1)
          const filteredChapterInfos = chapterInfos.filter(info => info.depth === targetDepth)

          // 如果目标层级有章节则使用，否则保留全部（兜底）
          if (filteredChapterInfos.length > 0) {
            chapterInfos = filteredChapterInfos
          }

          if (chapterInfos.length === 0) {
            chapterInfos = this.createFallbackChapterInfos(book, chapterNamingMode)
          }
        } else {
          const tocWithoutAnchors = toc.filter(item => item.href && !item.href.includes('#'))
          const estimatedTotal = Math.max(tocWithoutAnchors.length, spineItems.length)
          chapterInfos = await this.extractChaptersFromToc(
            book, tocWithoutAnchors, 0, maxSubChapterDepth, chapterNamingMode, estimatedTotal
          )

          if (tocWithoutAnchors.length <= 3) {
            const fallbackChapterInfos = this.createFallbackChapterInfos(book, chapterNamingMode)
            if (fallbackChapterInfos.length >= chapterInfos.length) {
              chapterInfos = fallbackChapterInfos
            }
          }
        }

        if (chapterInfos.length > 0) {
          // 使用并发限制器并行提取章节内容，最多3个并发
          const limiter = new ConcurrencyLimiter(3)

          // epub-toc：按相邻 TOC 条目的 spine 区间聚合（扉页 + 正文等多文件章）
          const spineRangeEnds =
            chapterDetectionMode === 'epub-toc'
              ? this.computeSpineRangeEnds(book, chapterInfos)
              : null
          const endAnchors =
            chapterDetectionMode === 'epub-toc'
              ? this.computeEndAnchors(chapterInfos)
              : null

          const chapterPromises = chapterInfos.map((chapterInfo, index) => {
            return limiter.execute(async () => {
              if (skipNonEssentialChapters && this.shouldSkipChapter(chapterInfo.title)) {
                return null
              }

              if (!asHrefString(chapterInfo.href)) {
                console.warn(`[EpubProcessor] 跳过无 href 的目录项: ${chapterInfo.title}`)
                return null
              }

              let chapterContent: string
              if (spineRangeEnds) {
                chapterContent = await this.extractContentBySpineRange(
                  book,
                  chapterInfo.href,
                  spineRangeEnds[index],
                  endAnchors?.[index]
                )
              } else {
                // normal/smart：保留 subitems 聚合行为
                chapterContent = await this.extractContentFromHref(
                  book,
                  chapterInfo.href,
                  chapterInfo.subitems
                )
              }

              if ((chapterContent || '').trim().length > 100) {
                return {
                  id: `chapter-${index + 1}`,
                  title: chapterInfo.title,
                  content: chapterContent,
                  href: chapterInfo.href,
                  tocItem: chapterInfo.tocItem,
                  depth: chapterInfo.depth
                } as ChapterData
              }
              return null
            })
          })

          const results = await Promise.all(chapterPromises)
          results.forEach(result => {
            if (result) {
              chapters.push(result)
            }
          })
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
    preserveAnchors: boolean = false,
    startIndex: number = 0
  ): Promise<ChapterInfo[]> {
    const chapterInfos: ChapterInfo[] = []
    let currentIndex = startIndex

    for (const item of toc) {
      try {
        const rawHref = asHrefString(item?.href)
        if (rawHref) {
          const href = preserveAnchors ? rawHref : rawHref.split('#')[0]

          let chapterTitle: string
          if (chapterNamingMode === 'numbered') {
            chapterTitle = `第${formatChapterNumber(currentIndex + 1, totalChapters)}章`
          } else {
            const rawTitle = item.label || `第${currentIndex + 1}章`
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
          currentIndex++
        }

        if (item.subitems && item.subitems.length > 0 && maxDepth > 0 && currentDepth < maxDepth - 1) {
          const subChapters = await this.extractChaptersFromToc(
            book, item.subitems, currentDepth + 1, maxDepth, chapterNamingMode, totalChapters, preserveAnchors, currentIndex
          )
          chapterInfos.push(...subChapters)
          currentIndex += subChapters.length
        }
      } catch (error) {
        console.warn(`跳过章节 "${item.label}":`, error)
      }
    }

    return chapterInfos
  }

  private async extractContentFromHref(book: Book, href: unknown, subitems?: NavItem[]): Promise<string> {
    try {
      const raw = asHrefString(href)
      if (!raw) return ''
      const [cleanHref, anchor] = raw.split('#')
      let allContent = ''

      const mainContent = await this.getSingleChapterContent(book, cleanHref, anchor)
      if (mainContent) {
        allContent += mainContent
      }

      if (subitems && subitems.length > 0) {
        for (const subitem of subitems) {
          const subRaw = asHrefString(subitem?.href)
          if (subRaw) {
            const [subHref, subAnchor] = subRaw.split('#')
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

  /**
   * 将 TOC href 解析为 spine 下标。兼容 Text/xxx.xhtml vs xxx.xhtml、URL 编码。
   * 对 undefined/非字符串 href 安全（避免 endsWith 读 undefined 崩溃）。
   */
  private resolveSpineIndex(book: Book, href: unknown): number {
    const spineItems = book.spine?.spineItems ?? []
    const cleanHref = normalizeHref(href)
    if (!cleanHref || spineItems.length === 0) return -1

    for (let i = 0; i < spineItems.length; i++) {
      if (hrefMatches(spineItems[i]?.href, cleanHref)) {
        return i
      }
    }

    return -1
  }

  /**
   * 为每个 TOC 章节计算 spine 区间右开边界（下一 TOC 条目的 spine 下标）。
   * 无后续条目时为 spine.length。
   */
  private computeSpineRangeEnds(book: Book, chapterInfos: ChapterInfo[]): number[] {
    const spineLen = book.spine?.spineItems?.length ?? 0
    const starts = chapterInfos.map((info) => this.resolveSpineIndex(book, info.href))

    return starts.map((start, i) => {
      if (start < 0) return -1

      // 优先：TOC 顺序上的下一条有效 spine
      for (let j = i + 1; j < starts.length; j++) {
        if (starts[j] > start) return starts[j]
        // 同文件不同锚点：仅取当前文件（内容边界由 endAnchor 截断）
        if (starts[j] === start) return start + 1
      }

      // 兜底：全局更大的 spine 下标（TOC 顺序与 spine 不一致时）
      let minGreater = -1
      for (let j = 0; j < starts.length; j++) {
        if (j === i) continue
        if (starts[j] > start && (minGreater < 0 || starts[j] < minGreater)) {
          minGreater = starts[j]
        }
      }
      if (minGreater > start) return minGreater

      return spineLen
    })
  }

  /** 同 spine 文件上下一条 TOC 的锚点（用于防止前章吞后章） */
  private computeEndAnchors(chapterInfos: ChapterInfo[]): Array<string | undefined> {
    return chapterInfos.map((info, i) => {
      const clean = normalizeHref(info.href)
      const [, startAnchor] = asHrefString(info.href).split('#')
      if (!clean) return undefined

      for (let j = i + 1; j < chapterInfos.length; j++) {
        const nextClean = normalizeHref(chapterInfos[j].href)
        if (nextClean !== clean) {
          // 不同文件：无需 endAnchor
          return undefined
        }
        const [, nextAnchor] = asHrefString(chapterInfos[j].href).split('#')
        if (nextAnchor && nextAnchor !== startAnchor) {
          return nextAnchor
        }
      }
      return undefined
    })
  }

  /**
   * 聚合 [startHref, endSpineIndexExclusive) 区间内所有有实质文本的 spine 页。
   * 用于 epub-toc：TOC 只指扉页、正文在后续文件的情况。
   */
  private async extractContentBySpineRange(
    book: Book,
    startHref: unknown,
    endSpineIndexExclusive: number,
    endAnchor?: string
  ): Promise<string> {
    const raw = asHrefString(startHref)
    const [cleanHref, anchor] = raw.split('#')
    try {
      if (!raw) return ''
      const spineItems = book.spine?.spineItems ?? []
      const startIdx = this.resolveSpineIndex(book, raw)

      if (startIdx < 0) {
        return this.getSingleChapterContent(book, cleanHref, anchor, endAnchor)
      }

      const endIdx =
        endSpineIndexExclusive < 0
          ? startIdx + 1
          : Math.min(Math.max(endSpineIndexExclusive, startIdx + 1), spineItems.length)

      const parts: string[] = []
      // 跳过近空页（插图 SVG 页通常只有书名等极短文本）
      const minPartLength = 20

      for (let i = startIdx; i < endIdx; i++) {
        // 仅起始文件使用起止锚点；中间页无锚点
        const partStartAnchor = i === startIdx ? anchor : undefined
        const partEndAnchor = i === startIdx ? endAnchor : undefined
        const text = await this.renderSpineItemText(book, i, partStartAnchor, partEndAnchor)
        if (text.trim().length >= minPartLength) {
          parts.push(text.trim())
        }
      }

      // 区间聚合失败时回退单文件 + 旧启发式
      if (parts.length === 0) {
        return this.getSingleChapterContent(book, cleanHref, anchor, endAnchor)
      }

      return parts.join('\n\n')
    } catch (error) {
      console.warn(`spine 区间提取失败 (href: ${raw}):`, error)
      return this.getSingleChapterContent(book, cleanHref, anchor, endAnchor)
    }
  }

  /** 按 spine 下标渲染并提取纯文本 */
  private async renderSpineItemText(
    book: Book,
    spineIndex: number,
    anchor?: string,
    endAnchor?: string
  ): Promise<string> {
    const section = book.spine.get(spineIndex)
    if (!section) return ''

    try {
      const chapterHTML = await section.render(book.load.bind(book))
      const textContent = this.extractTextFromXHTML(chapterHTML, anchor, endAnchor)
      section.unload()
      return textContent
    } catch (error) {
      try {
        section.unload()
      } catch {
        // ignore unload errors
      }
      console.warn(`[EpubProcessor] spine[${spineIndex}] 渲染失败:`, error)
      return ''
    }
  }

  private async getSingleChapterContent(
    book: Book,
    href: unknown,
    anchor?: string,
    endAnchor?: string
  ): Promise<string> {
    try {
      const spineItems = book.spine?.spineItems ?? []
      const spineIndex = this.resolveSpineIndex(book, href)

      if (spineIndex < 0) {
        console.warn(`[EpubProcessor] Spine匹配失败: href=${href}`)
        return ''
      }

      let textContent = await this.renderSpineItemText(book, spineIndex, anchor, endAnchor)

      // 封面-内容自动检测：如果内容为空，检查是否有 xxx_0001.xhtml 内容文件
      if (textContent.length < 100 && spineIndex >= 0 && spineIndex < spineItems.length - 1) {
        const nextSpineItem = spineItems[spineIndex + 1]
        const nextHref = asHrefString(nextSpineItem?.href)

        // 检查是否是 _0001.xhtml 格式的内容文件（nextHref 可能为空）
        if (nextHref && /_\d+\.xhtml$/i.test(nextHref)) {
          const nextText = await this.renderSpineItemText(book, spineIndex + 1, anchor, endAnchor)
          if (nextText.length > textContent.length) {
            textContent = nextText
          }
        }
      }

      return textContent
    } catch (error) {
      console.warn(`获取单个章节内容失败 (href: ${href}):`, error)
      return ''
    }
  }

  private extractTextFromXHTML(
    xhtmlContent: string,
    anchor?: string,
    endAnchor?: string
  ): string {
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
        textContent = this.extractContentByAnchor(doc, anchor, xhtmlContent, endAnchor)
      }

      if (!textContent.trim()) {
        textContent = body.textContent || ''
      }

      // 正文保留换行；标题清洗会把 \s+ 压成单空格
      return cleanAndFormatText(textContent)
    } catch {
      return this.extractTextWithRegex(xhtmlContent, anchor)
    }
  }

  private extractContentByAnchor(
    doc: Document,
    anchor: string,
    originalHtml: string,
    endAnchor?: string
  ): string {
    try {
      // 首先使用 getElementById，它对 XHTML 命名空间更可靠
      let anchorElement: Element | null = doc.getElementById(anchor)

      // 如果 getElementById 失败，尝试 querySelector 备选方案
      if (!anchorElement) {
        try {
          anchorElement = doc.querySelector(`[id="${anchor}"]`)
        } catch { /* ignore */ }
      }

      if (!anchorElement) {
        try {
          const escapedAnchor = CSS.escape(anchor)
          anchorElement = doc.querySelector(`[id="${escapedAnchor}"]`)
        } catch { /* ignore */ }
      }

      if (!anchorElement) {
        try {
          anchorElement = doc.querySelector(`[name="${anchor}"]`)
        } catch { /* ignore */ }
      }

      if (!anchorElement) {
        try {
          anchorElement = doc.querySelector(`[id*="${anchor}"]`)
        } catch { /* ignore */ }
      }

      // 如果找到了锚点元素，使用 DOM 方法提取内容
      if (anchorElement) {
        let endElement: Element | null = null
        if (endAnchor) {
          endElement =
            doc.getElementById(endAnchor) ||
            doc.querySelector(`[id="${CSS.escape(endAnchor)}"]`) ||
            doc.querySelector(`[name="${endAnchor}"]`)
        }
        const content = this.extractContentFromElement(anchorElement, endElement)
        if (content.length > 100) {
          return content
        }
        // DOM 提取内容太短，尝试正则提取
        const improvedContent = extractContentByAnchorImproved(originalHtml, anchor)
        if (improvedContent.length > content.length) {
          return improvedContent
        }
        return content
      }

      // 最后尝试正则提取
      return extractContentByAnchorImproved(originalHtml, anchor)
    } catch (error) {
      console.warn('锚点内容提取失败:', error)
      return ''
    }
  }

  private extractContentFromElement(
    anchorElement: Element,
    endElement?: Element | null
  ): string {
    // 首先包含锚点元素本身的文本（通常是章节标题）
    let content = anchorElement.textContent || ''

    // 然后添加后续兄弟元素的内容，直到下一 TOC 锚点
    let currentElement: Element | null = anchorElement.nextElementSibling
    while (currentElement) {
      if (endElement && (currentElement === endElement || currentElement.contains(endElement))) {
        break
      }
      if (
        endElement &&
        (currentElement.id === endElement.id ||
          currentElement.getAttribute('name') === endElement.getAttribute('name'))
      ) {
        break
      }
      content += '\n' + (currentElement.textContent || '')
      currentElement = currentElement.nextElementSibling
    }

    return cleanAndFormatText(content.trim())
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
    return cleanAndFormatText(textContent.replace(/<[^>]*>/g, ' '))
  }

  private shouldSkipChapter(title: string): boolean {
    return matchesSkipChapterTitle(title)
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
      const spineItems = book.spine?.spineItems ?? []

      // 移除 anchor 后再匹配（spineItem.href 可能为 undefined）
      const cleanHrefForMatch = normalizeHref(href)
      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i]
        if (hrefMatches(spineItem?.href, cleanHrefForMatch)) {
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
