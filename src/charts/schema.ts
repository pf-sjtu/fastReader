import { z } from 'zod'
import { CHART_LIMITS } from './types'

const entityNodeSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.coerce.string().min(1),
  type: z.string().optional(),
  description: z.string().optional(),
  importance: z.coerce.number().min(0).max(10).optional(),
})

const entityEdgeSchema = z.object({
  source: z.coerce.string().min(1),
  target: z.coerce.string().min(1),
  relation: z.coerce.string().min(1),
  description: z.string().optional(),
})

const entityGraphSchema = z.object({
  nodes: z.array(entityNodeSchema).default([]),
  edges: z.array(entityEdgeSchema).default([]),
})

const timelineEntitySchema = z.object({
  id: z.coerce.string().min(1),
  name: z.coerce.string().min(1),
  color: z.string().optional(),
  type: z.string().optional(),
})

const timelineEventSchema = z.object({
  id: z.coerce.string().min(1),
  label: z.coerce.string().min(1),
  timeLabel: z.coerce.string().default(''),
  order: z.coerce.number(),
  entityIds: z.array(z.coerce.string()).default([]),
  description: z.string().optional(),
  chapterHint: z.string().optional(),
})

const entityTimelineSchema = z.object({
  entities: z.array(timelineEntitySchema).default([]),
  events: z.array(timelineEventSchema).default([]),
})

export const bookChartsSchema = z.object({
  // 云存档 version 可能是 1 / "1" / 缺失
  version: z.preprocess(
    (v) => (v == null || v === '' ? 1 : Number(v)),
    z.literal(1)
  ).default(1),
  /** 新字段 */
  entityGraph: entityGraphSchema.optional(),
  /** 旧云存档 / 旧模型输出 */
  personGraph: entityGraphSchema.optional(),
  entityTimeline: entityTimelineSchema.optional(),
})

export type BookChartsParsed = z.infer<typeof bookChartsSchema>

/**
 * 裁剪超限 + 归一化：personGraph → entityGraph；
 * 时间线缺失实体从关系图回填
 */
export function enforceChartLimits(data: BookChartsParsed): BookChartsParsed {
  const out: BookChartsParsed = { version: 1 }
  const graphNodes: Array<{
    id: string
    name: string
    type?: string
    importance?: number
  }> = []

  const rawGraph = data.entityGraph || data.personGraph
  if (rawGraph) {
    let nodes = [...rawGraph.nodes]
    nodes.sort((a, b) => (b.importance ?? 5) - (a.importance ?? 5))
    nodes = nodes.slice(0, CHART_LIMITS.maxNodes)
    graphNodes.push(...nodes)
    const nodeIds = new Set(nodes.map((n) => n.id))

    let edges = rawGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
    )
    edges = edges.slice(0, CHART_LIMITS.maxEdges)

    if (nodes.length > 0) {
      // 只写 entityGraph，云存档与新代码统一用新字段
      out.entityGraph = { nodes, edges }
    }
  }

  if (data.entityTimeline) {
    let entities = [...(data.entityTimeline.entities || [])]
    const entityById = new Map(entities.map((e) => [e.id, e]))
    const graphById = new Map(graphNodes.map((n) => [n.id, n]))

    const refCount = new Map<string, number>()
    for (const ev of data.entityTimeline.events || []) {
      for (const id of ev.entityIds || []) {
        refCount.set(id, (refCount.get(id) || 0) + 1)
        if (!entityById.has(id)) {
          const gn = graphById.get(id)
          if (gn) {
            const ent = {
              id: gn.id,
              name: gn.name,
              type: gn.type || '实体',
            }
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
