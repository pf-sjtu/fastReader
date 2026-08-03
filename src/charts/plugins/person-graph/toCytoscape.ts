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

/**
 * 节点尺寸：名字写在球上，需要更大
 * importance 1–10 → 直径约 48–88
 */
export function nodeSize(importance: number): number {
  const imp = Math.min(10, Math.max(1, importance || 5))
  return 48 + imp * 4
}

/** 球内文字最大宽度略小于直径 */
export function nodeLabelMaxWidth(importance: number): number {
  return Math.max(36, nodeSize(importance) - 12)
}

/**
 * 力导向参数（类似 Obsidian：斥力 + 边弹簧）
 * force 0–100，默认 50
 */
export function forceLayoutOptions(force: number) {
  const f = Math.min(100, Math.max(0, force))
  // 斥力：越大节点越散
  const nodeRepulsion = 2000 + f * 180
  // 理想边长：力越大越拉开
  const idealEdgeLength = 40 + f * 2.2
  // 边弹性：略降使边可拉长
  const edgeElasticity = 0.45
  // 重力：力大时略降，减少向中心塌缩
  const gravity = Math.max(0.15, 0.55 - f * 0.003)
  // 节点间距
  const packing = 1 + f * 0.02

  return {
    name: 'fcose' as const,
    quality: 'default' as const,
    animate: true,
    animationDuration: 650,
    animationEasing: 'ease-out',
    randomize: false,
    fit: true,
    padding: 40,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: () => nodeRepulsion,
    idealEdgeLength: () => idealEdgeLength,
    edgeElasticity: () => edgeElasticity,
    gravity,
    gravityRange: 3.8,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 12 + f * 0.4,
    tilingPaddingHorizontal: 12 + f * 0.4,
    packingFactor: packing,
  }
}
