/**
 * remark 插件：把正文里的实体名包成 <span class="entity-mark" data-entity-id="...">。
 * - 只处理 text 节点，跳过 code / inlineCode / link 等，不改变 Markdown 语义
 * - 悬停 / 点击由容器事件委托处理（见 workspace），这里只产出节点
 * - 不依赖 unist-util-visit：手写递归，避免新增依赖
 */
import { findEntityMatches, type EntityMatcher } from './entityIndex'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
}

const SKIP_TYPES = new Set([
  'code',
  'inlineCode',
  'link',
  'linkReference',
  'definition',
  'html',
  'image',
  'imageReference',
  'entityMark',
])

export const ENTITY_MARK_CLASS = 'entity-mark'

export interface RemarkEntityMarkOptions {
  matcher: EntityMatcher
}

function splitText(value: string, matcher: EntityMatcher): MdNode[] | null {
  const matches = findEntityMatches(matcher, value)
  if (!matches.length) return null
  const out: MdNode[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > cursor) out.push({ type: 'text', value: value.slice(cursor, m.start) })
    out.push({
      type: 'entityMark',
      data: {
        hName: 'span',
        hProperties: { className: [ENTITY_MARK_CLASS], 'data-entity-id': m.entityId },
      },
      children: [{ type: 'text', value: value.slice(m.start, m.end) }],
    })
    cursor = m.end
  }
  if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) })
  return out
}

function walk(node: MdNode, matcher: EntityMatcher): void {
  if (!node.children || SKIP_TYPES.has(node.type)) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitText(child.value, matcher)
      if (parts) next.push(...parts)
      else next.push(child)
    } else {
      walk(child, matcher)
      next.push(child)
    }
  }
  node.children = next
}

/** unified 插件：用法 remarkPlugins={[[remarkEntityMark, { matcher }], ...]}；数组需 useMemo 保持稳定 */
export function remarkEntityMark(options: RemarkEntityMarkOptions) {
  return (tree: MdNode) => {
    if (!options?.matcher || !options.matcher.size) return
    walk(tree, options.matcher)
  }
}
