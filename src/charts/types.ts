/**
 * 关键图表：统一数据结构与插件契约
 * 新增图表类型：扩 BookCharts + zod + 注册 plugin，无需改 Tabs 壳
 */
import type { ComponentType } from 'react'

export interface PersonGraphNode {
  id: string
  name: string
  type?: string
  description?: string
  /** 1–10，越高越核心 */
  importance?: number
}

export interface PersonGraphEdge {
  source: string
  target: string
  relation: string
  description?: string
}

export interface PersonGraph {
  nodes: PersonGraphNode[]
  edges: PersonGraphEdge[]
}

export interface TimelineEntity {
  id: string
  name: string
  /** CSS 色值；缺省由布局层按 id 哈希分配 */
  color?: string
  type?: string
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
  personGraph?: PersonGraph
  entityTimeline?: EntityTimeline
}

export interface ChartPluginProps {
  charts: BookCharts
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
