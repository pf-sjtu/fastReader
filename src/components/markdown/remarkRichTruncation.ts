import { isRichLang } from '@/lib/richBlocks'

interface Node {
  type: string
  lang?: string | null
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  data?: { hProperties?: Record<string, unknown> }
  children?: Node[]
}

/** mdast 的 code 节点不区分闭合与截断；从对应原文判断，传给渲染组件。 */
export function remarkRichTruncation() {
  return (tree: Node, file: { value: string | Uint8Array }) => {
    const source = String(file.value)
    const visit = (node: Node) => {
      if (node.type === 'code' && isRichLang(node.lang ?? undefined)) {
        const start = node.position?.start?.offset, end = node.position?.end?.offset
        if (start !== undefined && end !== undefined) {
          const lines = source.slice(start, end).split(/\r\n|\r|\n/)
          const opening = /(`{3,}|~{3,})/.exec(lines[0])
          const open = opening?.[1]
          const last = lines[lines.length - 1]
          const lineStart = Math.max(source.lastIndexOf('\n', start - 1), source.lastIndexOf('\r', start - 1)) + 1
          const prefix = source.slice(lineStart, start) + lines[0].slice(0, opening?.index ?? 0)
          const depth = (prefix.match(/>/g) ?? []).length
          const closing = /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]{0,3})(`+|~+)[ \t]*$/.exec(last)
          const close = closing && (closing[1].match(/>/g) ?? []).length === depth ? closing[3] : undefined
          if (open && !(lines.length > 1 && close && close[0] === open[0] && close.length >= open.length)) {
            node.data ??= {}
            node.data.hProperties = { ...node.data.hProperties, 'data-rich-truncated': 'true' }
          }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
