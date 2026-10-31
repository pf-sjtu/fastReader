/**
 * 关键图表：统一数据结构与插件契约
 * 新增图表类型：扩 BookCharts + zod + 注册 plugin，无需改 Tabs 壳
 */
import type { ComponentType } from 'react'

/** 实体关系图节点（人物/概念/理论/物种等） */
export interface EntityGraphNode {
  id: string
  name: string
  type?: string
  description?: string
  /** 1–10，越高越核心 */
  importance?: number
  /** 可选：首次出场的章节提示（章节标题或序号）。缺省由客户端按章节总结里的出现位置推导 */
  chapterHint?: string
}

export interface EntityGraphEdge {
  source: string
  target: string
  relation: string
  description?: string
  /** 可选：该关系成立/首次出现的章节提示。缺省取两端实体共同出现的章节 */
  chapterHint?: string
}

/** 实体关系图（原 personGraph，兼容旧缓存字段） */
export interface EntityGraph {
  nodes: EntityGraphNode[]
  edges: EntityGraphEdge[]
}

/** @deprecated 使用 EntityGraphNode */
export type PersonGraphNode = EntityGraphNode
/** @deprecated 使用 EntityGraphEdge */
export type PersonGraphEdge = EntityGraphEdge
/** @deprecated 使用 EntityGraph */
export type PersonGraph = EntityGraph

export interface TimelineEntity {
  id: string
  name: string
  /** CSS 色值；缺省由布局层按 id 哈希分配 */
  color?: string
  type?: string
  /**
   * 简介：与主实体关系、定位、角色等（表头展示，可截断，悬停看全文）
   */
  description?: string
}

export interface TimelineEvent {
  id: string
  label: string
  /** 可读时间/阶段标签，如「童年」「1985」「第 12 章」 */
  timeLabel: string
  /** 叙事顺序，越小越早 */
  order: number
  entityIds: string[]
  description?: string
  chapterHint?: string
}

export interface EntityTimeline {
  entities: TimelineEntity[]
  events: TimelineEvent[]
}

/** 统一图表数据（version 便于缓存迁移） */
export interface BookCharts {
  version: 1
  /** 实体关系图（推荐） */
  entityGraph?: EntityGraph
  /**
   * @deprecated 旧云存档字段，解析时会归一到 entityGraph
   */
  personGraph?: EntityGraph
  entityTimeline?: EntityTimeline
}

/** 读取实体关系图（兼容 personGraph） */
export function getEntityGraph(charts: BookCharts): EntityGraph | undefined {
  const g = charts.entityGraph || charts.personGraph
  if (!g?.nodes?.length) return undefined
  return g
}

/** 阅读焦点：当前章与聚焦实体，由工作台计算后传给图表做高亮 */
export interface ChartFocus {
  chapterId?: string
  /** 当前章出现的实体 id */
  chapterEntityIds?: ReadonlySet<string>
  /** 当前章对应的时间线事件 id */
  chapterEventIds?: ReadonlySet<string>
  focusedEntityId?: string | null
  focusedEventId?: string | null
  /** 渐进模式（截至本章，含本章）：只有这些实体可见；undefined = 不过滤 */
  visibleEntityIds?: ReadonlySet<string>
  /** 渐进模式下可见的关系边（key 见 edgeKey）；undefined = 不过滤 */
  visibleEdgeKeys?: ReadonlySet<string>
  /** 每次"跳转"自增：连续两次跳到同一对象时靠它重新触发定位与高亮 */
  jumpNonce?: number
}

/** 视口坐标下的锚点矩形（卡片据此定位） */
export interface ChartAnchor {
  x: number
  y: number
  width: number
  height: number
}

/** 关系边在图表数据里的稳定键（图谱元素、联动查询表、渐进模式过滤共用） */
export function edgeKey(e: { source: string; target: string; relation: string }): string {
  return `${e.source}\u0001${e.target}\u0001${e.relation}`
}

export interface ChartEntityStyle {
  /** 色槽 1..10；null = 中性色（未分到独立色） */
  slot?: number | null
  cssVar: string
  shape: 'circle' | 'round-rect' | 'diamond'
}

/**
 * 插件入参。除 charts 外全部可选且向后兼容：
 * 旧插件只读 charts 即可；联动能力由工作台按需传入。
 */
export interface ChartPluginProps {
  charts: BookCharts
  focus?: ChartFocus
  /** 所在页签是否可见；隐藏时不做 fit / 高亮动画 */
  active?: boolean
  /** 单击实体：只选中并交给宿主展开卡片，不跳转 */
  onEntitySelect?: (id: string | null, anchor?: ChartAnchor) => void
  /** 双击实体：可选快捷——定位到正文中的下一次出现 */
  onEntityDoubleClick?: (id: string) => void
  /** 单击时间线事件：同样只展开卡片 */
  onEventSelect?: (id: string, anchor?: ChartAnchor) => void
  onChapterJump?: (chapterId: string) => void
  /** 实体出现在哪些章节（用于详情里的"出场章节"列表） */
  resolveEntityChapters?: (id: string) => { chapterId: string; title: string; count: number }[]
  /** 事件 → 章节（映射不上为 null，UI 置灰） */
  resolveEventChapter?: (eventId: string) => string | null
  styleOf?: (id: string) => ChartEntityStyle | undefined
  /** 图谱/时间线是否使用与正文一致的实体色（默认 false = 旧的单色外观） */
  colorize?: boolean
}

export interface ChartPlugin {
  id: string
  /** i18n key under results.charts.* */
  titleKey: string
  order: number
  hasData: (charts: BookCharts) => boolean
  Component: ComponentType<ChartPluginProps>
}

/** 数量上限：保证可读 + 控制 token */
export const CHART_LIMITS = {
  maxNodes: 40,
  maxEdges: 80,
  maxEntities: 12,
  maxEvents: 50,
} as const
