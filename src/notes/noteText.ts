/**
 * 「一章正文里，笔记可以定位到的那部分文字」——**正文高亮与笔记页签必须同一口径**。
 *
 * 两侧共用本模块，从同一份「不可定位块」定义出发：
 *
 * - 正文高亮（`remarkNoteMark` 插件）在自己的 mdast 上调用 `collectLocatableText`；
 * - 笔记页签（NotesPanel 判「已失去定位」）用 `noteSearchText` 把 markdown 解析成 mdast，
 *   再走同一个收集器。
 *
 * 早先只有围栏代码块是对齐的（页签用 `splitByFences`，插件按 `code` 节点跳过），
 * 但缩进代码块、围栏外的原始 HTML（`<!-- -->`、`<div>`）在 mdast 里分别是 `code` 与
 * `html` 节点——两边的剔除集合不同，于是出现「页签说已定位、正文一处都画不出来」。
 * 独立审查实测过这两种引文，这里改成共用一份判定，从结构上消除这类分歧。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'

/** mdast 的一小部分形状（不为类型多引一个依赖） */
export interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
}

/**
 * 不参与定位的节点：代码（围栏与**缩进**代码块都是 `code`）、原始 HTML（围栏外的
 * `<div>` / `<!-- -->` 是 `html`，行内 HTML 也是）、图片与链接定义（没有可标注文字）。
 */
export const NOTE_SKIP_TYPES = new Set(['code', 'html', 'image', 'imageReference', 'definition'])

/**
 * 一个节点的可定位文字：`text` 与 `inlineCode` 的 value，跳过 `NOTE_SKIP_TYPES`。
 * 与 `remarkNoteMark` 的 `collectSegments` 必须产出逐字相同的串（它另外记录了下标）。
 */
export function collectNodeText(node: MdNode, out: string[] = []): string[] {
  if (!node.children) return out
  for (const child of node.children) {
    if (NOTE_SKIP_TYPES.has(child.type)) continue
    if ((child.type === 'text' || child.type === 'inlineCode') && typeof child.value === 'string') {
      out.push(child.value)
    } else {
      collectNodeText(child, out)
    }
  }
  return out
}

/** 单个顶层块的原始文字（插件侧的 `raw` 就是这个） */
export function blockText(block: MdNode): string {
  return collectNodeText(block).join('')
}

/**
 * 整章的「可定位正文」：顶层块按顺序拼接，块间补一个换行。
 * 与 `remarkNoteMark` 拼给 resolver 的 `joined` 逐字相同（空白的块两侧都跳过）。
 */
export function collectLocatableText(tree: MdNode): string {
  let joined = ''
  for (const child of tree.children ?? []) {
    if (NOTE_SKIP_TYPES.has(child.type)) continue
    const raw = blockText(child)
    if (!raw.trim()) continue
    if (joined) joined += '\n'
    joined += raw
  }
  return joined
}

/** 与正文渲染同一条 remark 链，保证解析出来的树与插件看到的一致 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkTailQuestions)

/**
 * 一章 markdown → 可定位正文。
 *
 * 只做「去掉不可高亮的块」，不重写 markdown 语法：定位本身容忍标点与大小写。
 * 未闭合的围栏（生成被截断）由 remark 当成「到文件末尾都是代码块」处理，天然不参与定位。
 */
export function noteSearchText(markdown: string): string {
  if (!markdown) return ''
  const tree = processor.parse(markdown) as unknown as MdNode
  // 顶层问句会被 remarkTailQuestions 包成 chapterQuestions，文字不变，这里不需要额外处理
  return collectLocatableText(tree)
}
