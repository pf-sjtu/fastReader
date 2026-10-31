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
}

export interface EntityGraphEdge {
  source: string
  target: string
  relation: string
  description?: string
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
}

export interface ChartEntityStyle {
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
  onEntitySelect?: (id: string | null) => void
  onChapterJump?: (chapterId: string) => void
  /** 实体出现在哪些章节（用于详情里的"出场章节"列表） */
  resolveEntityChapters?: (id: string) => { chapterId: string; title: string; count: number }[]
  /** 事件 → 章节（映射不上为 null，UI 置灰） */
  resolveEventChapter?: (eventId: string) => string | null
  styleOf?: (id: string) => ChartEntityStyle | undefined
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
