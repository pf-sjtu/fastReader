/**
 * EPUB 单个 spine 文档内的锚点切片（纯 DOM 函数，无 epubjs 依赖）
 *
 * 目录项 href 形如 `text00000.html#filepos0000046465`：一个 spine 文件里往往塞了多章，
 * 靠锚点把"本章起点 → 下一目录项起点"之间的内容切出来。
 *
 * 为什么不用 getElementById + nextElementSibling：
 * - Mobi 转 EPUB 的锚点是空元素 `<span id="filepos…"/>`，标题在它的**后继兄弟**里，
 *   而下一章的锚点可能嵌在别的容器里，兄弟遍历碰不到终点就会一路读到文件末尾；
 * - 用 Range 按文档顺序切 [起点, 终点)，与嵌套层级无关。
 */

/** 块级元素：切片转文本时在其前后断行 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript'])
/** HTML 空元素：其余标签的 `<x/>` 在 HTML 解析下会被当成开标签，需要展开 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const anchorIndexCache = new WeakMap<Document, Map<string, Element>>()

/**
 * 把 `<span id="x"/>` 这类非空元素的自闭合写法展开成 `<span id="x"></span>`，
 * 否则 HTML 解析器会把它当开标签、吞掉后面所有内容。
 */
export function expandSelfClosingTags(html: string): string {
  return html.replace(/<([A-Za-z][\w:-]*)(\s[^<>]*?)?\s*\/>/g, (m, tag: string, attrs?: string) =>
    VOID_TAGS.has(tag.toLowerCase()) ? m : `<${tag}${attrs ?? ''}></${tag}>`,
  )
}

/** epubjs 序列化出的根元素偶发重复 xmlns（`duplicate attribute: xmlns`），XML 解析会整体失败 */
function dedupeRootXmlns(html: string): string {
  return html.replace(/<html\b[^>]*>/i, (tag) => {
    let seen = false
    return tag.replace(/\sxmlns=("[^"]*"|'[^']*')/g, (m) => {
      if (seen) return ''
      seen = true
      return m
    })
  })
}

/**
 * 解析一个 spine 文档。先按 XHTML 解析（保留命名空间），失败再退到宽松的 HTML 解析——
 * 绝不返回"解析失败"，调用方不需要再走正则兜底。
 */
export function parseSectionDoc(html: string): Document {
  const parser = new DOMParser()
  const fixed = dedupeRootXmlns(html)
  let doc = parser.parseFromString(fixed, 'application/xhtml+xml')
  if (doc.querySelector('parsererror') || !doc.body) {
    doc = parser.parseFromString(expandSelfClosingTags(fixed), 'text/html')
  }
  doc.querySelectorAll('script, style').forEach((el) => el.remove())
  return doc
}

function sectionBody(doc: Document): Element {
  return doc.body ?? doc.documentElement
}

/** 文档内 id / name → 元素 的索引（每个文档只建一次，章节多时避免反复全树扫描） */
function anchorIndex(doc: Document): Map<string, Element> {
  let index = anchorIndexCache.get(doc)
  if (index) return index
  index = new Map()
  for (const el of Array.from(doc.querySelectorAll('[id], [name]'))) {
    const id = el.getAttribute('id')
    if (id && !index.has(id)) index.set(id, el)
    const name = el.getAttribute('name')
    if (name && !index.has(name)) index.set(name, el)
  }
  anchorIndexCache.set(doc, index)
  return index
}

/** 精确查锚点（id 优先，其次旧式 `<a name>`；兼容 URL 编码）。不做子串模糊匹配：`ch1` 不能命中 `ch10` */
export function findAnchor(doc: Document, anchor: string | undefined): Element | null {
  if (!anchor) return null
  const index = anchorIndex(doc)
  const direct = index.get(anchor)
  if (direct) return direct
  try {
    const decoded = decodeURIComponent(anchor)
    if (decoded !== anchor) return index.get(decoded) ?? null
  } catch {
    // keep raw
  }
  return null
}

/**
 * 切出 [anchor, endAnchor) 之间的片段。
 * - anchor 缺省 / 找不到：从 body 开头起（找不到时返回 `anchorMissing`，供调用方告警）
 * - endAnchor 缺省 / 找不到 / 位于起点之前：切到 body 末尾
 */
export function sliceSection(
  doc: Document,
  anchor?: string,
  endAnchor?: string,
): { fragment: DocumentFragment; anchorMissing: boolean } {
  const body = sectionBody(doc)
  const range = doc.createRange()
  const start = findAnchor(doc, anchor)
  const anchorMissing = !!anchor && !start

  if (start) range.setStartBefore(start)
  else range.setStart(body, 0)

  let end = findAnchor(doc, endAnchor)
  if (end && start) {
    // 终点必须在起点之后，且不能是起点的祖先 / 自身，否则区间为空
    const pos = start.compareDocumentPosition(end)
    const isAfter = (pos & 4) !== 0 // DOCUMENT_POSITION_FOLLOWING
    const isInside = (pos & 16) !== 0 // 终点在起点内部：起点是个包住后续章节的容器
    if (!isAfter || isInside) end = null
  } else if (end && !start) {
    // 起点缺失时仍可按终点截断，但终点不能在 body 开头之前
    if (!body.contains(end)) end = null
  }

  if (end) range.setEndBefore(end)
  else range.setEnd(body, body.childNodes.length)

  return { fragment: range.cloneContents(), anchorMissing }
}

/** 片段转可读纯文本：块级元素断行、行内空白折叠、`<br>` 换行、脚本样式剔除 */
export function fragmentToText(fragment: DocumentFragment | Element): string {
  let out = ''
  const walk = (node: Node, inPre: boolean): void => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? ''
      out += inPre ? text : text.replace(/[\s\u00a0]+/g, ' ')
      return
    }
    if (node.nodeType !== 1) {
      node.childNodes.forEach((c) => walk(c, inPre))
      return
    }
    const el = node as Element
    const tag = el.localName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return
    if (tag === 'br') {
      out += '\n'
      return
    }
    const block = BLOCK_TAGS.has(tag)
    if (block) out += '\n'
    el.childNodes.forEach((c) => walk(c, inPre || tag === 'pre'))
    if (block) out += '\n'
  }
  walk(fragment, false)

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 片段转 HTML 字符串（供阅读面板 innerHTML，已展开自闭合标签） */
export function fragmentToHtml(doc: Document, fragment: DocumentFragment): string {
  const holder = doc.createElement('div')
  // 克隆而非移动：调用方之后还可能继续读取同一个 fragment（如取文本）
  holder.appendChild(fragment.cloneNode(true))
  return expandSelfClosingTags(holder.innerHTML)
}

/** 整页链接文字占比（目录页 / 导航页的特征） */
export function isNavigationLike(doc: Document): boolean {
  const body = sectionBody(doc)
  const total = (body.textContent ?? '').replace(/\s+/g, '').length
  if (total === 0) return false
  let linkChars = 0
  let links = 0
  body.querySelectorAll('a[href]').forEach((a) => {
    linkChars += (a.textContent ?? '').replace(/\s+/g, '').length
    links++
  })
  return links >= 5 && linkChars / total > 0.6
}
