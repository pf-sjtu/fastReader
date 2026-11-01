/**
 * remark 插件：把正文里被划线的片段包成 `<mark class="note-mark" data-note-id data-color>`。
 *
 * 为什么不在 DOM 上后处理：正文是 react-markdown 渲染的，流式生成时 React 会反复重建这些节点，
 * 手工插进去的 <mark> 会被抹掉甚至让 React 删错节点。插件在 AST 阶段就改好，渲染天然幂等，
 * 且和既有 `remarkEntityMark`（实体标注）同一条路子。
 *
 * 匹配复用 `src/notes/anchor.ts` 的 `createNoteResolver`：精确 → 忽略空白标点 → 滑窗相似度（模糊重定位）。
 * 锚点算在「归一化文本」上，所以这里要把归一化下标映射回每个 text 节点的原始切片再切开。
 *
 * 只处理块内的文本后代；`code` / `html` / `image` 等不碰；块只收集 / 归一化一次（同一块被多条笔记查）。
 * 插件实例必须按章节传（笔记属于某一章），调用方用 useMemo 保持引用稳定。
 */
import { createNoteResolver, normalizeText, type NoteAnchor, type NoteResolver } from './anchor'
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
 * 重叠时包出嵌套 mark，两层颜色各自可见。
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
}

/** 收集块内所有可标注的 text 节点（按文档顺序），同时拼出块的原始文本 */
function collectSegments(block: MdNode): { segments: Segment[]; raw: string } {
  const segments: Segment[] = []
  let raw = ''
  const visit = (node: MdNode): void => {
    if (!node.children) return
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]
      if (SKIP_TYPES.has(child.type)) continue
      if (child.type === 'text' && typeof child.value === 'string') {
        segments.push({ node: child, parent: node, index: i, start: raw.length, value: child.value })
        raw += child.value
      } else {
        visit(child)
      }
    }
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

/** 把 [rs, re) 这段原始下标包成一个 noteMark（跨 text 节点时逐段切开） */
function wrapRange(segments: readonly Segment[], rs: number, re: number, note: Note): boolean {
  let wrapped = false
  // 倒序处理：先改靠后的兄弟节点，前面节点的 children 下标才不会失效
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]
    const segEnd = seg.start + seg.value.length
    const from = Math.max(rs, seg.start)
    const to = Math.min(re, segEnd)
    if (to <= from) continue
    const before = seg.value.slice(0, from - seg.start)
    const hit = seg.value.slice(from - seg.start, to - seg.start)
    const after = seg.value.slice(to - seg.start)
    const parts: MdNode[] = []
    if (before) parts.push({ type: 'text', value: before })
    parts.push({
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
      children: [{ type: 'text', value: hit }],
    })
    if (after) parts.push({ type: 'text', value: after })
    seg.parent.children!.splice(seg.index, 1, ...parts)
    wrapped = true
  }
  return wrapped
}

/** 块内文本 + 定位器：同一块被多条笔记反复定位时只收集、归一化一次 */
interface BlockInfo {
  segments: Segment[]
  raw: string
  resolver: NoteResolver
}

/** 在块里给单条笔记找位置并包裹；返回是否真的包上了 */
function markOne(note: Note, info: BlockInfo): boolean {
  const { segments, raw, resolver } = info
  if (!segments.length || !raw.trim()) return false
  const anchor: NoteAnchor | null = resolver.resolve(note)
  if (!anchor) return false
  // 归一化下标 → 原始下标：起点取首字符、终点取末字符 +1
  const { map } = normalizeWithMap(raw)
  const rs = map[anchor.start]
  const re = anchor.end > 0 ? map[Math.min(anchor.end, map.length) - 1] + 1 : rs
  if (rs === undefined || re <= rs) return false
  return wrapRange(segments, rs, re, note)
}

/** 一棵树里所有块节点（顶层子节点各算一块；列表等嵌套结构内部的文本一并算进所在块） */
function eachBlock(tree: MdNode, fn: (block: MdNode) => boolean): void {
  for (const child of tree.children ?? []) {
    if (fn(child)) return
  }
}

/**
 * unified 插件：`remarkPlugins={[[remarkNoteMark, { notes }], ...]}`。
 * 每条笔记只包第一处命中（同一句重复出现时不再刷满整章）。
 */
export function remarkNoteMark(options: RemarkNoteMarkOptions) {
  return (tree: MdNode) => {
    const notes = options?.notes
    if (!notes?.length) return
    // 每次运行（= 一张章节卡）一份缓存：块只收集一次，正文化只归一化 / 折叠一次
    const cache = new Map<MdNode, BlockInfo>()
    const infoOf = (block: MdNode): BlockInfo => {
      let info = cache.get(block)
      if (!info) {
        const { segments, raw } = collectSegments(block)
        info = { segments, raw, resolver: createNoteResolver(raw) }
        cache.set(block, info)
      }
      return info
    }
    for (const note of notes) {
      if (note.deleted) continue
      if (!normalizeText(note.quote)) continue
      eachBlock(tree, (block) => {
        if (!markOne(note, infoOf(block))) return false
        // 包过之后块内的 text 节点被切开、下标全变了，这份缓存必须作废（下次重新收集）
        cache.delete(block)
        return true
      })
    }
  }
}

/** 导出给测试与调用方：判断一条笔记在当前章节文本里能否定位 */
export function isNoteLocated(note: Note, chapterText: string): boolean {
  return createNoteResolver(chapterText).resolve(note) !== null
}

/** 便利函数：只保留能匹配上的笔记（渲染前过滤用，可选） */
export function locatedNotes(notes: readonly Note[], chapterText: string): Note[] {
  const resolver = createNoteResolver(chapterText)
  return notes.filter((n) => !n.deleted && resolver.resolve(n) !== null)
}
