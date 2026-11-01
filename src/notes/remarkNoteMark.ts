/**
 * remark 插件：把正文里被划线的片段包成 `<mark class="note-mark" data-note-id data-color>`。
 *
 * 为什么不在 DOM 上后处理：正文是 react-markdown 渲染的，流式生成时 React 会反复重建这些节点，
 * 手工插进去的 <mark> 会被抹掉甚至让 React 删错节点。插件在 AST 阶段就改好，渲染天然幂等，
 * 且和既有 `remarkEntityMark`（实体标注）同一条路子。
 *
 * 匹配复用 `src/notes/anchor.ts` 的 `createNoteResolver`：精确 → 忽略空白标点 → 滑窗相似度（模糊重定位）。
 *
 * 三条来自独立审查的行为约定（`tests/notes/remarkNoteMark.test.ts` 里有逐条回归）：
 *
 * 1. **定位在「整章」范围上一次做完**，而不是「撞上第一块就画」。
 *    以前按块逐个试，短引文（如「编号10」）常在更早的段落里被模糊匹配到「编号1」，
 *    于是划线画到无关文字上、真正的原句反而不画。这里把各块的文本按顺序拼起来
 *    （块间补一个换行，与 `makeNote` 把选区换行折成空格的归一化同源），用**一个** resolver
 *    对整章定位：exact 永远优先，同一句出现多次时由 resolver 用前后文挑最像的一处。
 * 2. **每条笔记只画一处**：引文跨块时（用户在正文里跨段落划的，引文天生带空格）
 *    只画起点所在那一块里能画的部分，不再在多个块里各画一个同 id 的 mark。
 * 3. 块内**包裹前重新收集** text 节点：前一条笔记切开过节点后，段落下标就变了。
 *
 * 只处理块内的文本后代；`code` / `html` / `image` 等不碰。插件实例必须按章节传
 * （笔记属于某一章），调用方用 useMemo 保持引用稳定。
 */
import { createNoteResolver, normalizeText } from './anchor'
import type { Note } from './notes'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
}

/**
 * 不参与标注的节点：代码、原始 HTML、图片、定义。
 *
 * 注意这里**不含** `noteMark`：两条笔记的引文重叠时（一条长句、一条句中的短语），
 * 后一条必须还能在已经包好的 mark 内部找到位置，否则第二处划线不显示。
 * 重叠时包出嵌套 mark，两层颜色各自可见；`.note-mark` 因此不设水平内边距，
 * 免得嵌套时把文字横向推开（见 `src/index.css`）。
 */
const SKIP_TYPES = new Set(['code', 'html', 'image', 'imageReference', 'definition'])

export const NOTE_MARK_CLASS = 'note-mark'

export interface RemarkNoteMarkOptions {
  /** 本章的笔记（调用方按章节过滤好；墓碑由调用方先过 visibleNotes） */
  notes: readonly Note[]
}

/** 一个 text 节点在块内原始文本里的位置 */
interface Segment {
  node: MdNode
  parent: MdNode
  index: number
  /** 在块原始文本里的起始下标 */
  start: number
  value: string
  /**
   * 所属「块级单元」的编号：同一段文字里跨行内格式（`**粗体**`、链接）算一个单元，
   * 列表项之间、引用里的段落之间则各算一个。同一条笔记只在一个单元内画，
   * 免得跨列表项画出多个同 id 的 mark。
   */
  group: number
  /**
   * 行内代码（`map`）：它的文字进 raw（否则「正文里选到行内代码」的引文定位不上，
   * 笔记页签却说已定位），但包裹时要整段替换，不能切它的 value。
   */
  code?: boolean
}

/** 切分「块级单元」的节点类型：行内格式（strong/em/link/inlineCode）不在其中 */
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'tableCell', 'tableRow', 'blockquote', 'list'])

/** 收集块内所有可标注的 text 节点（按文档顺序），同时拼出块的原始文本 */
function collectSegments(block: MdNode): { segments: Segment[]; raw: string } {
  const segments: Segment[] = []
  let raw = ''
  let group = 0
  let groupSeq = 0
  const visit = (node: MdNode): void => {
    if (!node.children) return
    const outer = group
    if (BLOCK_TYPES.has(node.type)) group = ++groupSeq
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]
      if (SKIP_TYPES.has(child.type)) continue
      if (child.type === 'text' && typeof child.value === 'string') {
        segments.push({ node: child, parent: node, index: i, start: raw.length, value: child.value, group })
        raw += child.value
      } else if (child.type === 'inlineCode' && typeof child.value === 'string') {
        segments.push({ node: child, parent: node, index: i, start: raw.length, value: child.value, group, code: true })
        raw += child.value
      } else {
        visit(child)
      }
    }
    group = outer
  }
  visit(block)
  return { segments, raw }
}

/**
 * 与 `normalizeText` 同语义（空白折叠 + 去首尾），但额外给出「归一化下标 → 原始下标」的映射。
 * 两个函数必须同步演化：resolveNote 返回的下标就是按 normalizeText 算的。
 */
function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let pendingSpace = -1
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      if (pendingSpace < 0) pendingSpace = i
      continue
    }
    if (pendingSpace >= 0) {
      if (text.length > 0) {
        text += ' '
        map.push(pendingSpace)
      }
      pendingSpace = -1
    }
    text += ch
    map.push(i)
  }
  return { text, map }
}

/** 原始文本 at 处那个码点占几个 UTF-16 单元 */
function unitLength(raw: string, at: number): number {
  const cp = raw.codePointAt(at)
  return cp !== undefined && cp > 0xffff ? 2 : 1
}

function markNode(note: Note, children: MdNode[]): MdNode {
  return {
    type: 'noteMark',
    data: {
      hName: 'mark',
      hProperties: {
        className: [NOTE_MARK_CLASS],
        'data-note-id': note.id,
        'data-color': String(note.color),
        ...(note.comment.trim() ? { title: note.comment.trim().slice(0, 200) } : {}),
      },
    },
    children,
  }
}

/**
 * 把 [rs, re) 这段原始下标包成 noteMark。
 *
 * 跨 text 节点时逐段切开（行内格式必然如此：`**关键结论**，务必记住` 里两边是不同的 text 节点），
 * 但只在**起点所在的块级单元**里画：引文跨列表项时不再于每个列表项各画一个同 id 的 mark。
 * 行内代码整段包（切它的 value 会丢掉 `code` 语义），只覆盖了一部分时就不标它。
 */
function wrapRange(segments: readonly Segment[], rs: number, re: number, note: Note): boolean {
  const startGroup = segments.find((seg) => rs < seg.start + seg.value.length && re > seg.start)?.group
  if (startGroup === undefined) return false
  let wrapped = false
  // 倒序处理：先改靠后的兄弟节点，前面节点的 children 下标才不会失效
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]
    if (seg.group !== startGroup) continue
    const segEnd = seg.start + seg.value.length
    const from = Math.max(rs, seg.start)
    const to = Math.min(re, segEnd)
    if (to <= from) continue
    if (seg.code) {
      if (from !== seg.start || to !== segEnd) continue
      seg.parent.children!.splice(seg.index, 1, markNode(note, [seg.node]))
      wrapped = true
      continue
    }
    const before = seg.value.slice(0, from - seg.start)
    const hit = seg.value.slice(from - seg.start, to - seg.start)
    const after = seg.value.slice(to - seg.start)
    const parts: MdNode[] = []
    if (before) parts.push({ type: 'text', value: before })
    parts.push(markNode(note, [{ type: 'text', value: hit }]))
    if (after) parts.push({ type: 'text', value: after })
    seg.parent.children!.splice(seg.index, 1, ...parts)
    wrapped = true
  }
  return wrapped
}

/** 一个顶层块在「整章拼起来的原文」里的位置 */
interface BlockInfo {
  node: MdNode
  raw: string
  /** 块原始文本在整章拼接串里的起始下标 */
  start: number
}

/**
 * unified 插件：`remarkPlugins={[[remarkNoteMark, { notes }], ...]}`。
 * 每条笔记只包一处，位置由整章范围的锚点解析决定。
 */
export function remarkNoteMark(options: RemarkNoteMarkOptions) {
  return (tree: MdNode) => {
    const notes = options?.notes
    if (!notes?.length) return

    // 先把这一章所有块拼成一份文本：定位要在整章范围内比较，不能边找边画
    const blocks: BlockInfo[] = []
    let joined = ''
    for (const child of tree.children ?? []) {
      if (SKIP_TYPES.has(child.type)) continue
      const { raw } = collectSegments(child)
      if (!raw.trim()) continue
      if (joined) joined += '\n'
      blocks.push({ node: child, raw, start: joined.length })
      joined += raw
    }
    if (!blocks.length || !joined) return

    const { map } = normalizeWithMap(joined)
    const resolver = createNoteResolver(joined)

    for (const note of notes) {
      if (note.deleted) continue
      if (!normalizeText(note.quote)) continue
      const anchor = resolver.resolve(note)
      if (!anchor) continue
      const rs = map[anchor.start]
      const last = anchor.end > 0 ? map[Math.min(anchor.end, map.length) - 1] : undefined
      if (rs === undefined || last === undefined) continue
      const re = last + unitLength(joined, last)
      if (re <= rs) continue
      // 引文可能跨块（跨段落划的引文天生带空格）：只画起点那一块里能画的部分
      const startBlock =
        blocks.find((b) => rs >= b.start && rs < b.start + b.raw.length) ??
        [...blocks].reverse().find((b) => rs >= b.start)
      if (!startBlock) continue
      const localRs = Math.max(0, Math.min(rs - startBlock.start, startBlock.raw.length - 1))
      const localRe = Math.max(localRs + 1, Math.min(re - startBlock.start, startBlock.raw.length))
      // 前一条笔记切开过 text 节点后段落下标就变了，包裹前必须重新收集
      wrapRange(collectSegments(startBlock.node).segments, localRs, localRe, note)
    }
  }
}
