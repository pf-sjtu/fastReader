/**
 * 思维导图 → 纯文本（整书导图生成时作为章节「摘要」输入）
 */

interface MindNodeLike {
  topic?: unknown
  children?: unknown
}

function asNode(value: unknown): MindNodeLike | null {
  return value && typeof value === 'object' ? (value as MindNodeLike) : null
}

function childrenOf(node: MindNodeLike): MindNodeLike[] {
  return Array.isArray(node.children)
    ? (node.children.map(asNode).filter(Boolean) as MindNodeLike[])
    : []
}

function topicOf(node: MindNodeLike): string {
  return typeof node.topic === 'string' ? node.topic.trim() : ''
}

/**
 * 把章节导图根节点以下的前 `depth` 层拍平为缩进列表文本。
 * 根节点 topic 通常就是章节名，信息量低，故不计入层数也不输出。
 * 无可用节点时返回空字符串，由调用方回退。
 */
export function flattenMindMapToText(mindMap: unknown, depth = 2): string {
  const data = asNode(mindMap) as { nodeData?: unknown } | null
  const root = asNode(data?.nodeData)
  if (!root || depth <= 0) return ''

  const lines: string[] = []
  const walk = (nodes: MindNodeLike[], level: number) => {
    if (level > depth) return
    for (const node of nodes) {
      const topic = topicOf(node)
      if (topic) lines.push(`${'  '.repeat(level - 1)}- ${topic}`)
      walk(childrenOf(node), level + 1)
    }
  }
  walk(childrenOf(root), 1)
  return lines.join('\n')
}
