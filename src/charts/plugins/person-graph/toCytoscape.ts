import type { EntityGraph } from '../../types'

export interface CyElement {
  data: Record<string, unknown>
  classes?: string
}

/**
 * BookCharts entityGraph → cytoscape elements
 */
export function toCytoscapeElements(graph: EntityGraph): CyElement[] {
  const nodes: CyElement[] = (graph.nodes || []).map((n) => ({
    data: {
      id: n.id,
      label: n.name,
      name: n.name,
      type: n.type || '',
      description: n.description || '',
      importance: n.importance ?? 5,
    },
  }))

  const nodeIds = new Set(nodes.map((n) => String(n.data.id)))
  const edges: CyElement[] = (graph.edges || [])
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target)
    .map((e, i) => ({
      data: {
        id: `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        label: e.relation,
        relation: e.relation,
        description: e.description || '',
      },
    }))

  return [...nodes, ...edges]
}

/** 按 importance 映射节点尺寸（标签在节点外，圆可略小） */
export function nodeSize(importance: number): number {
  const imp = Math.min(10, Math.max(1, importance || 5))
  return 26 + imp * 2.5
}
