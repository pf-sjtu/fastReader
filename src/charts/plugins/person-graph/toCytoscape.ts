import type { EntityGraph } from '../../types'

export interface CyElement {
  data: Record<string, unknown>
  classes?: string
}

export interface NodeLabelLayout {
  /** 节点直径 px */
  size: number
  fontSize: number
  /** 球内文字最大宽度（必须明显小于直径） */
  textMaxWidth: number
  /** 已按行拆好的标签（含 \\n） */
  displayLabel: string
}

/** 估算字符显示宽度单位：CJK≈1，其它≈0.55 */
function charUnits(ch: string): number {
  if (/[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(ch)) return 1
  if (ch === '·' || ch === '•') return 0.4
  if (ch === ' ' || ch === '（' || ch === '）' || ch === '(' || ch === ')') return 0.45
  return 0.55
}

function measureUnits(s: string): number {
  let u = 0
  for (const ch of s) u += charUnits(ch)
  return u
}

/**
 * 按「显示宽度单位」换行，保证每行不超过 maxUnits
 */
export function wrapLabelByUnits(text: string, maxUnits: number): string[] {
  const raw = (text || '').trim()
  if (!raw) return ['?']
  const limit = Math.max(1.5, maxUnits)
  const lines: string[] = []
  let line = ''
  let lineU = 0
  for (const ch of raw) {
    const u = charUnits(ch)
    if (line && lineU + u > limit) {
      lines.push(line)
      line = ch
      lineU = u
    } else {
      line += ch
      lineU += u
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['?']
}

/**
 * 根据名字长度 + 重要度，计算球径与字号，使文字落在圆内
 */
export function layoutNodeLabel(name: string, importance = 5): NodeLabelLayout {
  const raw = (name || '').trim() || '?'
  const totalU = measureUnits(raw)

  // 字号随长度递减
  let fontSize = 12
  if (totalU > 14) fontSize = 8
  else if (totalU > 10) fontSize = 9
  else if (totalU > 7) fontSize = 10
  else if (totalU > 5) fontSize = 11

  // 目标行数 2–3，推算每行单位
  const targetLines = totalU <= 4 ? 1 : totalU <= 9 ? 2 : 3
  const maxUnitsPerLine = Math.max(2, totalU / targetLines)
  let lines = wrapLabelByUnits(raw, maxUnitsPerLine)

  const clampThreeLines = (ls: string[], perLine: number): string[] => {
    if (ls.length <= 3) return ls
    const head = ls.slice(0, 2)
    const rest = ls.slice(2).join('')
    const thirdParts = wrapLabelByUnits(rest, Math.max(1.5, perLine - 0.9))
    let third = thirdParts[0] || ''
    if (thirdParts.length > 1 || measureUnits(rest) > perLine) {
      // 末行截断加省略
      let t = ''
      let u = 0
      for (const ch of third) {
        const cu = charUnits(ch)
        if (u + cu > perLine - 1) break
        t += ch
        u += cu
      }
      third = (t || third.slice(0, 1)) + '…'
    }
    return [...head, third]
  }

  lines = clampThreeLines(lines, maxUnitsPerLine)

  const maxLineU = Math.max(...lines.map(measureUnits), 1)
  const lineHeight = fontSize * 1.22
  const textW = maxLineU * fontSize * 1.02
  const textH = lines.length * lineHeight
  // 内接圆：矩形对角线 + 内边距
  const diagonal = Math.sqrt(textW * textW + textH * textH)
  const need = Math.ceil(diagonal + fontSize * 1.8)

  const imp = Math.min(10, Math.max(1, importance || 5))
  const minByImp = 52 + imp * 2.5
  const size = Math.min(128, Math.max(minByImp, need, 56))

  // text-max-width 必须明显小于直径，否则会画出圆外
  const textMaxWidth = Math.max(22, Math.floor(size * 0.66))
  const maxUByWidth = textMaxWidth / (fontSize * 0.98)
  lines = clampThreeLines(wrapLabelByUnits(raw, maxUByWidth), maxUByWidth)

  return {
    size,
    fontSize,
    textMaxWidth,
    displayLabel: lines.join('\n'),
  }
}

/**
 * BookCharts entityGraph → cytoscape elements
 */
export function toCytoscapeElements(graph: EntityGraph): CyElement[] {
  const nodes: CyElement[] = (graph.nodes || []).map((n) => {
    const layout = layoutNodeLabel(n.name, n.importance ?? 5)
    return {
      data: {
        id: n.id,
        label: layout.displayLabel,
        name: n.name,
        type: n.type || '',
        description: n.description || '',
        importance: n.importance ?? 5,
        size: layout.size,
        fontSize: layout.fontSize,
        textMaxWidth: layout.textMaxWidth,
      },
    }
  })

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

/** @deprecated 使用 layoutNodeLabel；保留给旧测试 */
export function nodeSize(importance: number): number {
  const imp = Math.min(10, Math.max(1, importance || 5))
  return 52 + imp * 2.5
}

export function nodeLabelMaxWidth(importance: number): number {
  return Math.max(28, nodeSize(importance) * 0.68)
}

/**
 * 力导向参数（类似 Obsidian：斥力 + 边弹簧）
 * force 0–100，默认 50
 */
export function forceLayoutOptions(force: number) {
  const f = Math.min(100, Math.max(0, force))
  const nodeRepulsion = 2000 + f * 180
  const idealEdgeLength = 50 + f * 2.4
  const edgeElasticity = 0.45
  const gravity = Math.max(0.15, 0.55 - f * 0.003)
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

export interface LayoutPoint {
  x: number
  y: number
  /** 节点半径 px */
  r: number
}

/** 每个节点在画布上"应占"的单元边长：随力强度 0–100 从 110px 到 230px */
export function cellSide(force: number): number {
  return 110 + Math.min(100, Math.max(0, force)) * 1.2
}

/**
 * 布局后的等比压缩系数 ∈ (0,1]。
 * fcose 在小图上也会把节点撑到节点总面积的数十倍（实测 22 个 ~75px 节点撑到 2400×2500），
 * 导致画布里只能看到几个节点、fit 之后标签又小到读不出。
 * 这里按「n × 单元面积」估目标面积，并保证任意两节点中心距 ≥ (ri+rj)×1.25，压缩不会让节点重叠。
 */
export function compactScale(points: readonly LayoutPoint[], force: number): number {
  const n = points.length
  if (n < 2) return 1
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const area = Math.max(maxX - minX, 1) * Math.max(maxY - minY, 1)
  const side = cellSide(force)
  let s = Math.min(1, Math.sqrt((n * side * side) / area))

  // 防重叠下限：压缩后最近的一对仍要留出间隙
  let floor = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (d > 0) floor = Math.max(floor, ((points[i].r + points[j].r) * 1.25) / d)
    }
  }
  s = Math.max(s, Math.min(1, floor))
  return s
}
