import { z } from 'zod'
import { CHART_LIMITS } from './types'

const personNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().optional(),
  description: z.string().optional(),
  importance: z.number().min(0).max(10).optional(),
})

const personEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.string().min(1),
  description: z.string().optional(),
})

const personGraphSchema = z.object({
  nodes: z.array(personNodeSchema).default([]),
  edges: z.array(personEdgeSchema).default([]),
})

const timelineEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  type: z.string().optional(),
})

const timelineEventSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  timeLabel: z.string().default(''),
  order: z.number(),
  entityIds: z.array(z.string()).default([]),
  description: z.string().optional(),
  chapterHint: z.string().optional(),
})

const entityTimelineSchema = z.object({
  entities: z.array(timelineEntitySchema).default([]),
  events: z.array(timelineEventSchema).default([]),
})

export const bookChartsSchema = z.object({
  version: z.literal(1).default(1),
  personGraph: personGraphSchema.optional(),
  entityTimeline: entityTimelineSchema.optional(),
})

export type BookChartsParsed = z.infer<typeof bookChartsSchema>

/** 裁剪超限数据，保证可视化可读 */
export function enforceChartLimits(data: BookChartsParsed): BookChartsParsed {
  const out: BookChartsParsed = { version: 1 }

  if (data.personGraph) {
    let nodes = [...data.personGraph.nodes]
    // 按 importance 降序保留
    nodes.sort((a, b) => (b.importance ?? 5) - (a.importance ?? 5))
    nodes = nodes.slice(0, CHART_LIMITS.maxNodes)
    const nodeIds = new Set(nodes.map((n) => n.id))

    let edges = data.personGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
    )
    edges = edges.slice(0, CHART_LIMITS.maxEdges)

    if (nodes.length > 0) {
      out.personGraph = { nodes, edges }
    }
  }

  if (data.entityTimeline) {
    let entities = data.entityTimeline.entities.slice(0, CHART_LIMITS.maxEntities)
    const entityIds = new Set(entities.map((e) => e.id))

    let events = [...data.entityTimeline.events]
      .map((ev) => ({
        ...ev,
        entityIds: (ev.entityIds || []).filter((id) => entityIds.has(id)),
      }))
      .filter((ev) => ev.entityIds.length > 0 || entities.length === 0)
      .sort((a, b) => a.order - b.order)
      .slice(0, CHART_LIMITS.maxEvents)

    // 若事件引用了不存在的实体但实体列表为空，仍保留事件（退化展示）
    if (entities.length === 0 && data.entityTimeline.events.length > 0) {
      events = [...data.entityTimeline.events]
        .sort((a, b) => a.order - b.order)
        .slice(0, CHART_LIMITS.maxEvents)
    }

    if (entities.length > 0 || events.length > 0) {
      out.entityTimeline = { entities, events }
    }
  }

  return out
}
