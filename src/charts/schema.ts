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

/** 裁剪超限数据，保证可视化可读；补齐时间线缺失实体（从 personGraph 回填） */
export function enforceChartLimits(data: BookChartsParsed): BookChartsParsed {
  const out: BookChartsParsed = { version: 1 }
  const personNodes: Array<{ id: string; name: string; type?: string; importance?: number }> = []

  if (data.personGraph) {
    let nodes = [...data.personGraph.nodes]
    nodes.sort((a, b) => (b.importance ?? 5) - (a.importance ?? 5))
    nodes = nodes.slice(0, CHART_LIMITS.maxNodes)
    personNodes.push(...nodes)
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
    let entities = [...(data.entityTimeline.entities || [])]
    const entityById = new Map(entities.map((e) => [e.id, e]))
    const personById = new Map(personNodes.map((n) => [n.id, n]))

    // 统计事件引用；从 personGraph 补齐缺失实体
    const refCount = new Map<string, number>()
    for (const ev of data.entityTimeline.events || []) {
      for (const id of ev.entityIds || []) {
        refCount.set(id, (refCount.get(id) || 0) + 1)
        if (!entityById.has(id)) {
          const pn = personById.get(id)
          if (pn) {
            const ent = { id: pn.id, name: pn.name, type: pn.type || '人物' }
            entityById.set(id, ent)
            entities.push(ent)
          }
        }
      }
    }

    if (entities.length > CHART_LIMITS.maxEntities) {
      entities.sort((a, b) => (refCount.get(b.id) || 0) - (refCount.get(a.id) || 0))
      entities = entities.slice(0, CHART_LIMITS.maxEntities)
    }
    const entityIds = new Set(entities.map((e) => e.id))

    let events = [...(data.entityTimeline.events || [])]
      .map((ev) => ({
        ...ev,
        entityIds: (ev.entityIds || []).filter((id) => entityIds.has(id)),
      }))
      .filter((ev) => ev.entityIds.length > 0)
      .sort((a, b) => a.order - b.order)
      .slice(0, CHART_LIMITS.maxEvents)

    if (events.length === 0 && (data.entityTimeline.events?.length || 0) > 0) {
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
