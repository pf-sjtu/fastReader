/**
 * 图谱的联动状态：着色（统一实体色）、本章高亮/淡化、渐进模式隐藏、类型过滤、聚焦居中。
 * 全部是对 cytoscape 实例的命令式操作（canvas 库不走 React 渲染），集中在这里便于阅读与复用。
 */
import type { Core, NodeSingular } from 'cytoscape'
import { readableTextOn, resolveCssVarColor } from '../../theme'
import { edgeKey, type ChartAnchor, type ChartEntityStyle, type ChartFocus } from '../../types'

const CY_SHAPE = { circle: 'ellipse', 'round-rect': 'round-rectangle', diamond: 'diamond' } as const

/**
 * 给节点写入颜色/形状/文字色并打上 colorized class。
 * 颜色唯一来源是 index.css 的 --entity-N：这里只是把 var() 按当前明/暗主题解析成 hex，
 * 因此关闭"同色"只是去掉 class，不存在第二套色板；主题切换后重新调用即可。
 */
export function applyEntityStyle(
  cy: Core,
  styleOf: ((id: string) => ChartEntityStyle | undefined) | undefined,
  colorize: boolean
): void {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const s = colorize ? styleOf?.(n.id()) : undefined
      if (!s) {
        n.removeClass('colorized')
        return
      }
      const hex = resolveCssVarColor(s.cssVar)
      n.data({ color: hex, textColor: readableTextOn(hex), shape: CY_SHAPE[s.shape] })
      n.addClass('colorized')
    })
  })
}

export interface FocusInput {
  focus?: ChartFocus
  /** 图例里被关掉的类型分组 */
  hiddenGroups: ReadonlySet<string>
  groupOf: (nodeId: string) => string
}

/**
 * 本章高亮：本章出现的实体加粗描边，其余淡化（不隐藏——全局结构仍可见）；
 * 渐进模式：读到此处之前还没出现的实体/关系整体隐藏（含本章）。
 * 只改样式，不移动视角——"同步高亮不抢滚动"。
 */
export function applyGraphFocus(cy: Core, { focus, hiddenGroups, groupOf }: FocusInput): void {
  const visible = focus?.visibleEntityIds
  const visibleEdges = focus?.visibleEdgeKeys
  const hit = focus?.chapterEntityIds
  const useHit = !!hit && hit.size > 0

  cy.batch(() => {
    cy.elements().removeClass('gone filtered hit dim focused')
    cy.nodes().forEach((n) => {
      const id = n.id()
      if (visible && !visible.has(id)) n.addClass('gone')
      if (hiddenGroups.has(groupOf(id))) n.addClass('filtered')
      if (useHit) n.addClass(hit.has(id) ? 'hit' : 'dim')
      if (focus?.focusedEntityId === id) n.addClass('focused')
    })
    cy.edges().forEach((e) => {
      const s = e.source()
      const t = e.target()
      const key = edgeKey({ source: s.id(), target: t.id(), relation: String(e.data('relation') ?? '') })
      if (s.hasClass('gone') || t.hasClass('gone') || (visibleEdges && !visibleEdges.has(key))) e.addClass('gone')
      if (s.hasClass('filtered') || t.hasClass('filtered')) e.addClass('filtered')
      // 只有两端都在本章出现的关系才保持醒目
      if (useHit && !(s.hasClass('hit') && t.hasClass('hit'))) e.addClass('dim')
    })
  })
}

/** 把某个实体居中并选中（跳转到达）。节点不存在或被隐藏时返回 false */
export function centerOnNode(cy: Core, id: string): boolean {
  const n = cy.getElementById(id)
  if (n.empty() || n.hasClass('gone') || n.hasClass('filtered')) return false
  cy.nodes().unselect()
  n.select()
  cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 350, easing: 'ease-out' })
  return true
}

/** 节点在视口坐标下的矩形：宿主据此把卡片贴在节点旁边 */
export function nodeAnchor(node: NodeSingular, container: HTMLElement): ChartAnchor {
  const p = node.renderedPosition()
  const r = node.renderedWidth() / 2
  const box = container.getBoundingClientRect()
  return { x: box.left + p.x - r, y: box.top + p.y - r, width: r * 2, height: r * 2 }
}
