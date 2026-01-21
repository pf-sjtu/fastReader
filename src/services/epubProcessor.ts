import ePub, { Book, type NavItem } from '@ssshooter/epubjs'
import { SKIP_CHAPTER_KEYWORDS } from './constants'
import type Section from '@ssshooter/epubjs/types/section'

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
  // 章节定位信息，用于后续打开对应书页
  href?: string // 章节的href路径（用于定位和调试信息）
  tocItem?: NavItem // 原始的TOC项目信息
  depth?: number // 章节层级深度
}

export interface BookData {
  book: Book // epub.js Book instance
  title: string
  author: string
}

export class EpubProcessor {
  private processingFiles = new Set<string>() // 防重复处理的文件集合

  async parseEpub(file: File): Promise<BookData> {
    try {
      // 检查是否正在处理相同的文件
      const fileKey = `${file.name}_${file.size}_${file.lastModified}`
      if (this.processingFiles.has(fileKey)) {
        throw new Error('文件正在处理中，请稍候')
      }

      this.processingFiles.add(fileKey)
      try {
        // 将File转换为ArrayBuffer
        const arrayBuffer = await file.arrayBuffer()

        // 使用epub.js解析EPUB文件
        const book = ePub()
        await book.open(arrayBuffer)

        // 等待书籍加载完成
        await book.ready

        // 获取书籍元数据
        const title = book.packaging?.metadata?.title || '未知标题'
        const author = book.packaging?.metadata?.creator || '未知作者'

        return {
          book,
          title,
          author
        }
      } finally {
        // 处理完成后从集合中移除
        this.processingFiles.delete(fileKey)
      }
    } catch (error) {
      throw new Error(`解析EPUB文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  async extractBookData(file: File, useSmartDetection: boolean = false, skipNonEssentialChapters: boolean = true, maxSubChapterDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', chapterDetectionMode: 'normal' | 'smart' | 'epub-toc' = 'normal', epubTocDepth: number = 1): Promise<BookData & { chapters: ChapterData[] }> {
    const bookData = await this.parseEpub(file)
    const chapters = await this.extractChapters(bookData.book, useSmartDetection, skipNonEssentialChapters, maxSubChapterDepth, chapterNamingMode, chapterDetectionMode, epubTocDepth)
    
    return {
      ...bookData,
      chapters
    }
  }

  async extractChapters(book: Book, useSmartDetection: boolean = false, skipNonEssentialChapters: boolean = true, maxSubChapterDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', chapterDetectionMode: 'normal' | 'smart' | 'epub-toc' = 'normal', epubTocDepth: number = 1): Promise<ChapterData[]> {
    try {
      const chapters: ChapterData[] = []

      try {
        let chapterInfos: { title: string, href: string, subitems?: NavItem[], tocItem: NavItem, depth: number }[] = []

        if (chapterDetectionMode === 'epub-toc') {
          // EPUB目录模式：使用指定的目录深度，保留锚点链接以支持精确定位
          const toc = book.navigation.toc
          // 估算总章节数，用于补零格式化
          const estimatedTotal = Math.max(toc.length, book.spine.spineItems.length)
          chapterInfos = await this.extractChaptersFromToc(book, toc, 0, epubTocDepth, chapterNamingMode, estimatedTotal, true)

          // 回退：如果TOC为空或提取失败，使用spineItems
          if (chapterInfos.length === 0) {

            const fallbackChapterInfos = book.spine.spineItems
              .map((spineItem: Section, idx: number) => {
                const navItem: NavItem = {
                  id: spineItem.idref || `spine-${idx + 1}`,
                  href: spineItem.href,
                  label: chapterNamingMode === 'numbered' ? `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章` : (spineItem.idref || `章节 ${idx + 1}`),
                  subitems: []
                }
                return {
                  title: navItem.label || `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章`,
                  href: navItem.href!,
                  subitems: [],
                  tocItem: navItem,
                  depth: 0
                }
              })
            chapterInfos = fallbackChapterInfos

          }
        } else {
          // 普通模式和智能模式：使用原有逻辑
          const toc = book.navigation.toc.filter(item => !item.href.includes('#'))
          // 估算总章节数，用于补零格式化
          const estimatedTotal = Math.max(toc.length, book.spine.spineItems.length)
          chapterInfos = await this.extractChaptersFromToc(book, toc, 0, maxSubChapterDepth, chapterNamingMode, estimatedTotal)


          // 回退：当 TOC 长度≤3 时，直接用 spineItems 生成章节信息
          if (toc.length <= 3) {
            const fallbackChapterInfos = book.spine.spineItems
              .map((spineItem: Section, idx: number) => {
                const navItem: NavItem = {
                  id: spineItem.idref || `spine-${idx + 1}`,
                  href: spineItem.href,
                  label: chapterNamingMode === 'numbered' ? `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章` : (spineItem.idref || `章节 ${idx + 1}`),
                  subitems: []
                }
                return {
                  title: navItem.label || `第${formatChapterNumber(idx + 1, book.spine.spineItems.length)}章`,
                  href: navItem.href!,
                  subitems: [],
                  tocItem: navItem,
                  depth: 0
                }
              })
              .filter(item => !!item.href)

            if (fallbackChapterInfos.length >= chapterInfos.length) {
              chapterInfos = fallbackChapterInfos
            }

          }
        }
        if (chapterInfos.length > 0) {
          // 根据章节信息提取内容
          for (const chapterInfo of chapterInfos) {
            // 检查是否需要跳过此章节
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
      // 应用智能章节检测
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

  private async extractChaptersFromToc(book: Book, toc: NavItem[], currentDepth: number = 0, maxDepth: number = 0, chapterNamingMode: 'auto' | 'numbered' = 'auto', totalChapters: number = 99, preserveAnchors: boolean = false): Promise<{ title: string, href: string, subitems?: NavItem[], tocItem: NavItem, depth: number }[]> {
    const chapterInfos: { title: string, href: string, subitems?: NavItem[], tocItem: NavItem, depth: number }[] = []

    for (const item of toc) {
      try {
        // 首先处理当前项目（如果它有有效的href）
        if (item.href) {
          // 根据preserveAnchors参数决定是否保留锚点
          const href = preserveAnchors ? item.href : item.href.split('#')[0]
          
          // 根据章节命名模式生成标题
          let chapterTitle: string
          if (chapterNamingMode === 'numbered') {
            chapterTitle = `第${formatChapterNumber(chapterInfos.length + 1, totalChapters)}章`
          } else {
            // 清理章节标题中的HTML实体字符
            const rawTitle = item.label || `第${chapterInfos.length + 1}章`
            chapterTitle = this.cleanChapterTitle(rawTitle)
          }
          
          const chapterInfo: { title: string, href: string, subitems?: NavItem[], tocItem: NavItem, depth: number } = {
            title: chapterTitle,
            href: href, // 根据参数决定是否保留锚点
            subitems: item.subitems,
            tocItem: item, // 保存原始TOC项目信息
            depth: currentDepth // 保存章节层级深度
          }
          chapterInfos.push(chapterInfo)
        }
        
        // 然后递归处理子项目
        if (item.subitems && item.subitems.length > 0 && maxDepth > 0 && currentDepth < maxDepth - 1) {
          const subChapters = await this.extractChaptersFromToc(book, item.subitems, currentDepth + 1, maxDepth, chapterNamingMode, totalChapters, preserveAnchors)
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
      

      // 解析href，分离文件路径和锚点
      const [cleanHref, anchor] = href.split('#')

      let allContent = ''

      // 首先获取主章节内容
      const mainContent = await this.getSingleChapterContent(book, cleanHref, anchor)
      if (mainContent) {
        allContent += mainContent
      }

      // 如果有子项目，也要获取子项目的内容
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
      const spineItems = book.spine.spineItems


      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i]

        if (spineItem.href === href || spineItem.href.endsWith(href)) {
          section = book.spine.get(i)
          break
        }
      }

      if (!section) {
        console.warn(`无法获取章节: ${href}`)
        return ''
      }

      // 读取章节内容
      const chapterHTML = await section.render(book.load.bind(book))

      // 提取纯文本内容
      const { textContent } = this.extractTextFromXHTML(chapterHTML, anchor)

      // 卸载章节内容以释放内存
      section.unload()

      return textContent
    } catch (error) {
      console.warn(`获取单个章节内容失败 (href: ${href}):`, error)
      return ''
    }
  }

  private shouldSkipChapter(title: string): boolean {
    if (!title) return false

    return SKIP_CHAPTER_KEYWORDS.some(keyword =>
      title.toLowerCase().includes(keyword.toLowerCase())
    )
  }

  private extractTextFromXHTML(xhtmlContent: string, anchor?: string): { textContent: string } {
    try {
      // 创建一个临时的DOM解析器
      const parser = new DOMParser()
      const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml')

      // 检查解析错误
      const parseError = doc.querySelector('parsererror')
      if (parseError) {
        throw new Error('DOM解析失败')
      }

      // 提取正文内容
      const body = doc.querySelector('body')
      if (!body) {
        throw new Error('未找到body元素')
      }

      // 移除脚本和样式标签
      const scripts = body.querySelectorAll('script, style')
      scripts.forEach(el => el.remove())

      let textContent = ''

      // 如果有锚点，尝试定位到锚点位置并提取相关内容
      if (anchor) {
        textContent = this.extractContentByAnchor(doc, anchor)
      }

      // 如果锚点定位失败或没有锚点，提取全部内容
      if (!textContent.trim()) {
        textContent = body.textContent || ''
      }

      // 清理和格式化文本内容
      textContent = this.cleanAndFormatText(textContent)

      return { textContent }
    } catch (error) {
      console.warn('DOM解析失败，使用正则表达式备选方案:', error)
      // 如果DOM解析失败，使用正则表达式作为备选方案
      return this.extractTextWithRegex(xhtmlContent, anchor)
    }
  }

  private cleanChapterTitle(title: string): string {
    try {
      if (!title) return title
      
      // 解码HTML实体字符
      let cleaned = title
        .replace(/&amp;#160;/g, ' ')  // 处理嵌套的 &#160;
        .replace(/&amp;nbsp;/g, ' ')  // 处理嵌套的 &nbsp;
        .replace(/&#160;/g, ' ')      // 不间断空格
        .replace(/&nbsp;/g, ' ')      // 不间断空格
        .replace(/&#xA0;/g, ' ')      // 不间断空格（十六进制）
        .replace(/&amp;/g, '&')       // 和号
        .replace(/&lt;/g, '<')        // 小于号
        .replace(/&gt;/g, '>')        // 大于号
        .replace(/&quot;/g, '"')      // 引号
        .replace(/&#39;/g, "'")       // 单引号
        .replace(/&#\d+;/g, '')       // 移除其他数字实体
        .replace(/&[a-zA-Z]+;/g, '')  // 移除其他命名实体
      
      // 清理多余空格
      cleaned = cleaned.replace(/\s+/g, ' ').trim()
      
      return cleaned
    } catch (error) {
      console.warn('章节标题清理失败:', error)
      return title
    }
  }

  private cleanAndFormatText(text: string): string {
    try {
      // 解码HTML实体（包括嵌套的实体）
      let cleaned = text
        .replace(/&amp;#160;/g, ' ')  // 处理嵌套的 &#160;
        .replace(/&amp;nbsp;/g, ' ')  // 处理嵌套的 &nbsp;
        .replace(/&#160;/g, ' ')      // 不间断空格
        .replace(/&nbsp;/g, ' ')      // 不间断空格
        .replace(/&#xA0;/g, ' ')      // 不间断空格（十六进制）
        .replace(/&amp;/g, '&')       // 和号
        .replace(/&lt;/g, '<')        // 小于号
        .replace(/&gt;/g, '>')        // 大于号
        .replace(/&quot;/g, '"')      // 引号
        .replace(/&#39;/g, "'")       // 单引号
        .replace(/&#\d+;/g, '')       // 移除其他数字实体
        .replace(/&[a-zA-Z]+;/g, '')  // 移除其他命名实体

      // 智能换行处理
      cleaned = this.addSmartLineBreaks(cleaned)

      // 清理多余空白（但保留换行）
      cleaned = cleaned
        .replace(/[ \t]+/g, ' ')         // 合并空格和制表符，但不包括换行
        .replace(/\n[ \t]+\n/g, '\n')    // 合并空行
        .replace(/\n{3,}/g, '\n\n')      // 限制连续换行数
        .trim()

      return cleaned
    } catch (error) {
      console.warn('文本清理失败:', error)
      return text
    }
  }

  private addSmartLineBreaks(text: string): string {
    try {
      // 首先按句子添加换行
      let withBreaks = text
        .replace(/([。！？])([^ \n])/g, '$1\n$2')  // 中文句号后换行
        .replace(/([.!?])([a-zA-Z])/g, '$1\n$2')  // 英文句号后换行（后跟字母）
        .replace(/([.!?])(\s+[a-zA-Z])/g, '$1\n$2')  // 英文句号后换行（空格+字母）

      // 按标点符号添加换行
      withBreaks = withBreaks
        .replace(/([，,；;])([^ \n])/g, '$1\n$2')  // 逗号、分号后换行
        .replace(/([：:])([^ \n])/g, '$1\n$2')    // 冒号后换行

      // 按章节标题添加换行
      withBreaks = withBreaks
        .replace(/(第[一二三四五六七八九十\d]+章|第[一二三四五六七八九十\d]+节|第[一二三四五六七八九十\d]+篇|Chapter\s+\d+|Section\s+\d+)/g, '\n$1')
        .replace(/(封面|前言|序言|导论|目录|参考文献|附录)/g, '\n$1')

      // 处理超长行
      const sentences = withBreaks.split('\n')
      const formattedSentences = sentences.map(sentence => {
        const trimmed = sentence.trim()
        // 如果单行过长（超过150字符），强制换行
        if (trimmed.length > 150) {
          // 在适当位置换行
          let broken = trimmed
            .replace(/([，,；;]\s*)([^，,；;\n]{30,})/g, '$1\n$2')  // 逗号、分号后换行
            .replace(/(\s{2,})([^ \n]{30,})/g, '\n$2')               // 多个空格后换行
            .replace(/([a-zA-Z]+\s+)([a-zA-Z]+\s+[^ \n]{30,})/g, '$1\n$2') // 英文单词后换行
          
          // 如果还是很长，按字符数强制换行
          if (broken.length > 150) {
            const chunks: string[] = []
            for (let i = 0; i < broken.length; i += 120) {
              chunks.push(broken.substring(i, Math.min(i + 120, broken.length)))
            }
            broken = chunks.join('\n')
          }
          
          return broken
        }
        return trimmed
      })



      const result = formattedSentences.join('\n').trim()
      const lineCount = result.split('\n').length
      return result
    } catch (error) {
      console.warn('智能换行处理失败:', error)
      return text
    }
  }

  private extractTextWithRegex(xhtmlContent: string, anchor?: string): { title: string; textContent: string } {

    // 移除XML声明和DOCTYPE
    let cleanContent = xhtmlContent
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')

    // 移除脚本和样式标签及其内容
    cleanContent = cleanContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // 如果有锚点，尝试用正则表达式提取锚点内容
    let textContent = ''
    if (anchor) {
      textContent = this.extractContentByAnchorRegex(cleanContent, anchor)
    }

    // 如果锚点提取失败或没有锚点，提取全部内容
    if (!textContent.trim()) {
      // 提取标题
      const titleMatch = cleanContent.match(/<title[^>]*>([^<]*)<\/title>/i)
      const title = titleMatch ? this.cleanAndFormatText(titleMatch[1]) : ''

      // 提取正文内容
      const bodyMatch = cleanContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
      if (bodyMatch) {
        textContent = bodyMatch[1]
      } else {
        textContent = cleanContent
      }

      // 移除HTML标签并清理文本
      textContent = textContent.replace(/<[^>]*>/g, ' ')
      
      // 使用相同的文本清理逻辑
      textContent = this.cleanAndFormatText(textContent)

      

      return { title, textContent }
    } else {
      // 锚点提取成功，清理文本
      textContent = this.cleanAndFormatText(textContent)
      
      return { title: '', textContent }
    }
  }

  private extractContentByAnchor(doc: Document, anchor: string): string {
    try {
      // 转义锚点中的特殊字符
      const escapedAnchor = CSS.escape(anchor)

      // 查找锚点元素 - 使用属性选择器来处理以数字开头的ID
      const anchorElement = doc.querySelector(`[id="${escapedAnchor}"]`) || 
                           doc.querySelector(`[name="${escapedAnchor}"]`) ||
                           doc.querySelector(`[id*="${escapedAnchor}"]`)

      if (!anchorElement) {
        // 如果转义后还是找不到，尝试原始锚点
        
        const originalAnchorElement = doc.querySelector(`[id*="${anchor}"]`) ||
                                     doc.querySelector(`[name="${anchor}"]`)
        if (originalAnchorElement) {
          
          return this.extractContentFromElement(originalAnchorElement)
        }
        
        return ''
      }

      

      // 获取整个HTML内容用于正则表达式匹配
      const htmlContent = new XMLSerializer().serializeToString(doc)

      // 使用改进的锚点提取策略
      return this.extractContentByAnchorImproved(htmlContent, anchor)

    } catch (error) {
      console.warn('锚点内容提取失败:', error)
      return ''
    }
  }

  private extractContentByAnchorImproved(htmlContent: string, anchor: string): string {
    try {
      

      // 策略1：精确匹配id属性
      const exactIdMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${anchor}["'][^>]*>(.*?)</[^>]*>`, 'is'))
      if (exactIdMatch) {
        const content = exactIdMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (content.length > 10) {
          
          return this.cleanAndFormatText(content)
        }
      }

      // 策略2：查找包含锚点的标题元素
      const headingMatch = htmlContent.match(new RegExp(`<(h[1-6]|div|p|section)[^>]*id=["']${anchor}["'][^>]*>(.*?)</\\1>`, 'is'))
      if (headingMatch) {
        const content = headingMatch[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (content.length > 10) {
          
          return this.cleanAndFormatText(content)
        }
      }

      // 策略3：查找锚点后的内容到下一个标题
      const anchorElementMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${anchor}["'][^>]*>.*?</[^>]*>`, 'is'))
      if (anchorElementMatch) {
        const anchorStart = htmlContent.indexOf(anchorElementMatch[0])
        const afterAnchor = htmlContent.substring(anchorStart + anchorElementMatch[0].length)
        
        // 查找下一个标题作为结束点
        const nextHeadingMatch = afterAnchor.match(/<h[1-6][^>]*>/i)
        const endIndex = nextHeadingMatch && nextHeadingMatch[0] ? afterAnchor.indexOf(nextHeadingMatch[0]) : afterAnchor.length
        
        const content = afterAnchor.substring(0, endIndex)
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        
        if (content.length > 20) {
          
          return this.cleanAndFormatText(content)
        }
      }

      // 策略4：查找锚点所在段落的文本
      const paragraphMatch = htmlContent.match(new RegExp(`<p[^>]*>.*?id=["']${anchor}["'][^>]*>.*?</p>`, 'is'))
      if (paragraphMatch) {
        const content = paragraphMatch[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (content.length > 10) {
          
          return this.cleanAndFormatText(content)
        }
      }

      
      return ''
    } catch (error) {
      console.warn('改进锚点提取出错:', error)
      return ''
    }
  }

  private extractContentByAnchorRegex(htmlContent: string, anchor: string): string {
    try {
      

      // 策略1：查找带有id的标签
      const idMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${anchor}["'][^>]*>(.*?)</[^>]*>`, 'is'))
      if (idMatch) {
        const content = idMatch[1].replace(/<[^>]*>/g, ' ').trim()
        if (content.length > 20) {
          
          return this.cleanAndFormatText(content)
        }
      }

      // 策略2：查找带有name的标签
      const nameMatch = htmlContent.match(new RegExp(`<[^>]*name=["']${anchor}["'][^>]*>(.*?)</[^>]*>`, 'is'))
      if (nameMatch) {
        const content = nameMatch[1].replace(/<[^>]*>/g, ' ').trim()
        if (content.length > 20) {
          
          return this.cleanAndFormatText(content)
        }
      }

      // 策略3：查找包含锚点文本的标题
      const titleMatch = htmlContent.match(new RegExp(`<h[1-6][^>]*id=["'][^"']*${anchor}[^"']*["'][^>]*>(.*?)</h[1-6]>`, 'is'))
      if (titleMatch) {
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim()
        
        return this.cleanAndFormatText(title)
      }

      
      return ''
    } catch (error) {
      console.warn('正则表达式锚点提取失败:', error)
      return ''
    }
  }

  private extractContentFromHeading(doc: Document, headingElement: Element): string {
    try {
      
      const headingLevel = parseInt(headingElement.tagName.charAt(1))
      const content: string[] = []

      // 从标题开始遍历
      let currentElement: Element | null = headingElement.nextElementSibling

      while (currentElement) {
        // 收集当前元素的文本
        if (currentElement.textContent) {
          content.push(currentElement.textContent.trim())
        }

        // 移动到下一个元素
        currentElement = currentElement.nextElementSibling

        // 检查是否遇到同级或更高级的标题
        if (currentElement && currentElement.tagName && /^h[1-6]$/i.test(currentElement.tagName)) {
          const currentLevel = parseInt(currentElement.tagName.charAt(1))
          if (currentLevel <= headingLevel) {
            break
          }
        }

        // 防止无限循环
        if (content.length > 50) break
      }

      const result = content.join('\n').trim()
      
      return result
    } catch (error) {
      console.warn('标题内容提取失败:', error)
      return headingElement.textContent?.trim() || ''
    }
  }

  private extractContentFromSection(doc: Document, sectionElement: Element): string {
    try {
      // 提取section元素及其所有子元素的文本
      const textContent = sectionElement.textContent?.trim() || ''
      
      return textContent
    } catch (error) {
      console.warn('章节内容提取失败:', error)
      return sectionElement.textContent?.trim() || ''
    }
  }

  private extractContentFromGenericAnchor(doc: Document, anchorElement: Element): string {
    try {
      const content: string[] = []

      let currentElement: Element | null = anchorElement
      let collectedElements = 0

      // 从锚点元素开始，收集后续元素的文本
      while (currentElement && collectedElements < 10) {
        if (currentElement.textContent) {
          const text = currentElement.textContent.trim()
          if (text.length > 10) { // 只收集有意义的文本
            content.push(text)
            collectedElements++
          }
        }
        currentElement = currentElement.nextElementSibling
      }

      const result = content.join('\n').trim()
      
      return result
    } catch (error) {
      console.warn('通用锚点内容提取失败:', error)
      return anchorElement.textContent?.trim() || ''
    }
  }

  
  // 新增方法：获取章节的HTML内容（不影响原有功能）
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
        // 读取章节内容
        const chapterHTML = await section.render(book.load.bind(book))

        // 卸载章节内容以释放内存
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

  private detectChapters(chapters: ChapterData[], useSmartDetection: boolean, chapterNamingMode: 'auto' | 'numbered' = 'auto'): ChapterData[] {
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
      if (content.length < 100) continue // 跳过内容太少的章节

      // 检查是否是新章节的开始
      let isNewChapter = false
      let chapterTitle = chapter.title

      // 如果原标题不明确，尝试从内容中提取
      if (!chapterTitle || chapterTitle.includes('章节') || chapterTitle.includes('Chapter')) {
        for (const pattern of chapterPatterns) {
          const match = content.match(pattern)
          if (match) {
            // 提取章节标题（取前100个字符作为标题）
            const titleMatch = content.match(/^(.{1,100})/)
            chapterTitle = titleMatch ? titleMatch[1].trim() : `章节 ${chapterCount + 1}`
            isNewChapter = true
            break
          }
        }
      }

      if (isNewChapter || !currentChapter) {
        // 保存上一个章节
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

        // 开始新章节
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
        // 合并到当前章节
        currentChapter.content += '\n\n' + content
      }
    }

    // 保存最后一个章节
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

  // 从锚点元素提取内容的辅助函数
  private extractContentFromElement(anchorElement: Element): string {
    // 获取锚点元素之后的所有内容
    let content = ''
    let currentElement: Element | null = anchorElement.nextElementSibling
    
    while (currentElement) {
      content += currentElement.textContent + '\n'
      currentElement = currentElement.nextElementSibling
    }
    
    // 如果没有找到后续元素，获取锚点元素的内容
    if (!content.trim()) {
      content = anchorElement.textContent || ''
    }
    
    return this.cleanAndFormatText(content.trim())
  }
}
