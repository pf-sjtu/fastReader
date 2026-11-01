import { QUESTION_MAX, questionsOfLine } from '@/lib/tailQuestions'

/** 只用到 mdast 的一小部分形状，避免为类型多引一个依赖 */
interface Node {
  type: string
  value?: string
  children?: Node[]
  data?: Record<string, unknown>
}

const textOf = (n: Node): string => (n.value ?? '') + (n.children?.map(textOf).join('') ?? '')
const paragraph = (value: string): Node => ({ type: 'paragraph', children: [{ type: 'text', value }] })

/** 一个顶层节点 → 它代表的问句段落；不是「整块都是问句」就返回 null */
function asQuestionParagraphs(node: Node): Node[] | null {
  if (node.type === 'paragraph') {
    const kids = node.children ?? []
    if (kids.every((k) => k.type === 'text')) {
      const lines = textOf(node).split('\n').filter((l) => l.trim())
      const all = lines.map(questionsOfLine)
      return lines.length && all.every(Boolean) ? all.flat().map((q) => paragraph(q!)) : null
    }
    // 带加粗 / 斜体的单行问句：整段保留
    const t = textOf(node).trim()
    return !t.includes('\n') && /[？?]$/.test(t) && t.length <= QUESTION_MAX ? [node] : null
  }
  // 旧写法：「1. 问题？」列表 → 摊平成段落
  if (node.type === 'list') {
    const items = (node.children ?? []).map((li) => questionsOfLine(textOf(li).trim()))
    return items.length && items.every(Boolean) ? items.flat().map((q) => paragraph(q!)) : null
  }
  return null
}

/**
 * remark 插件：文末连续 ≥2 个问句 → 包进 <div class="chapter-questions">，样式把它与总结正文区分开
 * （点线分隔、更浅更小的衬线字）。兼容新格式（每题一段）与旧缓存里的「并成一段 / 同行连写 / 列表」。
 */
export function remarkTailQuestions() {
  return (tree: Node) => {
    const kids = tree.children ?? []
    const run: Node[] = []
    let start = kids.length
    while (start > 0) {
      const paras = asQuestionParagraphs(kids[start - 1])
      if (!paras) break
      run.unshift(...paras)
      start--
    }
    if (run.length < 2) return
    kids.splice(start, kids.length - start, {
      type: 'chapterQuestions',
      data: { hName: 'div', hProperties: { className: ['chapter-questions'] } },
      children: run,
    })
  }
}
