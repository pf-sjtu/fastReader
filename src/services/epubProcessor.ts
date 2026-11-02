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
  asHrefString,
  normalizeHref,
  hrefMatches,
} from './epub'
import {
  parseSectionDoc,
  sliceSection,
  fragmentToText,
  fragmentToHtml,
  isNavigationLike,
} from './epub/sectionSlice'
import type { ChapterData, BookData, ChapterInfo, ChapterNamingMode, ChapterDetectionMode } from './epub/types'
import { ConcurrencyLimiter } from '../utils/async'

export type { ChapterData, BookData }

/** 一章在 spine 上的一段：起止锚点只在起始文件上有意义 */
interface SpinePart {
  index: number
  anchor?: string
  endAnchor?: string
}

export class EpubProcessor {
  private processingFiles = new Set<string>()
  /** parseEpub 打开的 Book 实例，destroy() 时统一释放 */
  private openBooks = new Set<Book>()
  /**
   * 一次 extractChapters 期间的 spine 文档缓存（spine 下标 → 解析后的 Document）。
   * 一个大文件里常有几十章，不缓存就会被 render + 解析几十遍；结束后整体丢弃以免占内存。
   */
  private docCache = new WeakMap<Book, Map<number, Promise<Document | null>>>()

  /** 释放本实例打开的全部 EPUB（幂等） */
  destroy(): void {
    const books = [...this.openBooks]
    this.openBooks.clear()
    for (const book of books) {
      try {
        book.destroy()
      } catch (error) {
        console.warn('[EpubProcessor] 释放 EPUB 资源失败:', error)
      }
    }
  }

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
        try {
          await book.open(arrayBuffer)
          await book.ready
        } catch (openError) {
          try {
            book.destroy()
          } catch {
            // ignore
          }
          throw openError
        }
        this.openBooks.add(book)

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
    this.docCache.set(book, new Map())
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
                  depth: chapterInfo.depth,
                  // 阅读面板据此渲染与提取同一区间，避免"目录对、右侧内容错"
                  ...(spineRangeEnds
                    ? { endSpineIndex: spineRangeEnds[index], endAnchor: endAnchors?.[index] }
                    : {})
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
    } finally {
      this.docCache.delete(book)
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
   * 一章覆盖的 spine 片段：[起始文件, endSpineIndexExclusive)。
   * 提取（文本）与阅读面板（HTML）共用这一份计划，两边看到的就是同一段内容。
   * 起始 href 在 spine 里找不到时返回 null。
   */
  private planSpineParts(
    book: Book,
    startHref: unknown,
    endSpineIndexExclusive: number | undefined,
    endAnchor?: string
  ): SpinePart[] | null {
    const raw = asHrefString(startHref)
    if (!raw) return null
    const anchor = raw.split('#')[1] || undefined
    const startIdx = this.resolveSpineIndex(book, raw)
    if (startIdx < 0) return null

    const spineLen = book.spine?.spineItems?.length ?? 0
    const endIdx =
      endSpineIndexExclusive === undefined || endSpineIndexExclusive < 0
        ? startIdx + 1
        : Math.min(Math.max(endSpineIndexExclusive, startIdx + 1), spineLen)

    const parts: SpinePart[] = []
    for (let i = startIdx; i < endIdx; i++) {
      // 仅起始文件使用起止锚点；中间页无锚点
      parts.push(i === startIdx ? { index: i, anchor, endAnchor } : { index: i })
    }
    return parts
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
      const plan = this.planSpineParts(book, raw, endSpineIndexExclusive, endAnchor)
      if (!plan) {
        return this.getSingleChapterContent(book, cleanHref, anchor, endAnchor)
      }

      const parts: string[] = []
      // 跳过近空页（插图 SVG 页通常只有书名等极短文本）
      const minPartLength = 20

      for (const part of plan) {
        const doc = await this.loadSectionDoc(book, part.index)
        if (!doc) continue
        // 区间里夹带的目录/导航页（整页都是链接）不是正文，起始页除外
        if (part !== plan[0] && isNavigationLike(doc)) continue
        const text = this.sectionText(doc, part.anchor, part.endAnchor, raw)
        if (text.length >= minPartLength) {
          parts.push(text)
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

  /**
   * 渲染并解析一个 spine 文档。extractChapters 期间按 (book, 下标) 缓存解析结果；
   * 缓存里放的是 Promise，并发请求同一文件只会渲染一次。
   */
  private loadSectionDoc(book: Book, spineIndex: number): Promise<Document | null> {
    const cache = this.docCache.get(book)
    const cached = cache?.get(spineIndex)
    if (cached) return cached

    const pending = this.renderSectionDoc(book, spineIndex)
    cache?.set(spineIndex, pending)
    return pending
  }

  private async renderSectionDoc(book: Book, spineIndex: number): Promise<Document | null> {
    const section = book.spine.get(spineIndex)
    if (!section) return null

    try {
      const html = await section.render(book.load.bind(book))
      return parseSectionDoc(html)
    } catch (error) {
      console.warn(`[EpubProcessor] spine[${spineIndex}] 渲染失败:`, error)
      return null
    } finally {
      try {
        section.unload()
      } catch {
        // ignore unload errors
      }
    }
  }

  /** 切出 [anchor, endAnchor) 并转纯文本；锚点缺失时告警并按文件开头起算 */
  private sectionText(doc: Document, anchor: string | undefined, endAnchor: string | undefined, href: string): string {
    const { fragment, anchorMissing } = sliceSection(doc, anchor, endAnchor)
    if (anchorMissing) {
      console.warn(`[EpubProcessor] 锚点 #${anchor} 在文件内不存在，按文件开头起算 (href: ${href})`)
    }
    return fragmentToText(fragment)
  }

  /** 按 spine 下标渲染并提取纯文本 */
  private async renderSpineItemText(
    book: Book,
    spineIndex: number,
    anchor?: string,
    endAnchor?: string
  ): Promise<string> {
    const doc = await this.loadSectionDoc(book, spineIndex)
    if (!doc) return ''
    return this.sectionText(doc, anchor, endAnchor, `spine[${spineIndex}]`)
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
          detectedChapters.push({ ...currentChapter, content: currentChapter.content.trim() })
        }

        chapterCount++
        const fallbackTitle = chapterNamingMode === 'numbered'
          ? `第${formatChapterNumber(chapterCount, chapters.length)}章`
          : `第 ${chapterCount} 章`
        currentChapter = {
          ...chapter,
          id: chapter.id || `chapter-${chapterCount}`,
          title: chapterTitle || fallbackTitle,
          content: content
        }
      } else {
        currentChapter.content += '\n\n' + content
      }
    }

    if (currentChapter && currentChapter.content.trim().length > 200) {
      detectedChapters.push({ ...currentChapter, content: currentChapter.content.trim() })
    }

    return detectedChapters.length > 0 ? detectedChapters : chapters
  }

  /**
   * 阅读面板用：渲染"这一章"的 HTML，区间与提取阶段完全一致
   * （起始锚点 → 下一目录项锚点，跨文件时按 endSpineIndex 聚合）。
   * 没有区间信息的旧章节（normal 模式 / 旧缓存）退化为按 href 的锚点起点渲染整文件剩余部分。
   */
  async getChapterHTML(
    book: Book,
    chapter: { href?: string; endSpineIndex?: number; endAnchor?: string }
  ): Promise<string> {
    const href = chapter.href ?? ''
    try {
      const plan = this.planSpineParts(book, href, chapter.endSpineIndex, chapter.endAnchor)
      if (!plan) return this.getSingleChapterHTML(book, href)

      const htmlParts: string[] = []
      for (const part of plan) {
        const doc = await this.loadSectionDoc(book, part.index)
        if (!doc) continue
        if (part !== plan[0] && isNavigationLike(doc)) continue
        const { fragment } = sliceSection(doc, part.anchor, part.endAnchor)
        // 必须先取文本：fragmentToHtml 会把节点移进临时容器，之后 fragment 就是空的
        const textLength = fragmentToText(fragment).length
        const html = fragmentToHtml(doc, fragment)
        // 近空页（纯插图 SVG 页等）只在文字或图片存在时保留
        if (textLength >= 20 || /<img\b|<svg\b|<image\b/i.test(html)) {
          htmlParts.push(html)
        }
      }
      // 切片为空（锚点异常等）：退回整文件，宁可多显示也不要空白
      return htmlParts.length > 0 ? htmlParts.join('\n') : this.getSingleChapterHTML(book, href)
    } catch (error) {
      console.warn(`获取章节HTML失败 (href: ${href}):`, error)
      return this.getSingleChapterHTML(book, href)
    }
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
