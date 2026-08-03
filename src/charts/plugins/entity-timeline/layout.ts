import type { EntityTimeline, TimelineEntity, TimelineEvent } from '../../types'

/** 默认调色板（无 color 时按实体索引取） */
export const ENTITY_PALETTE = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#a855f7', // purple
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#e11d48', // rose
]

export interface TimelineLayoutConfig {
  rowHeight: number
  colWidth: number
  labelWidth: number
  headerHeight: number
  pad: number
}

export const DEFAULT_LAYOUT: TimelineLayoutConfig = {
  rowHeight: 56,
  colWidth: 120,
  labelWidth: 88,
  headerHeight: 40,
  pad: 8,
}

export interface LaidOutEvent {
  event: TimelineEvent
  entityId: string
  row: number
  col: number
  x: number
  y: number
  color: string
}

export interface TimelineLayoutResult {
  entities: TimelineEntity[]
  /** 去重后的时间行：按 order 排序 */
  timeRows: { order: number; timeLabel: string }[]
  items: LaidOutEvent[]
  width: number
  height: number
  config: TimelineLayoutConfig
  entityColor: Map<string, string>
}

/**
 * 纵轴=时间/order，横轴=实体列
 */
export function layoutEntityTimeline(
  data: EntityTimeline,
  config: TimelineLayoutConfig = DEFAULT_LAYOUT
): TimelineLayoutResult {
  const entities = data.entities?.length
    ? data.entities
    : // 从事件反推实体
      Array.from(
        new Set(data.events.flatMap((e) => e.entityIds || []))
      ).map((id) => ({ id, name: id }))

  const entityColor = new Map<string, string>()
  entities.forEach((ent, i) => {
    entityColor.set(ent.id, ent.color || ENTITY_PALETTE[i % ENTITY_PALETTE.length])
  })

  const sortedEvents = [...(data.events || [])].sort((a, b) => a.order - b.order)

  // 按 order 合并时间行（同 order 用第一条的 timeLabel）
  const rowMap = new Map<number, string>()
  for (const ev of sortedEvents) {
    if (!rowMap.has(ev.order)) {
      rowMap.set(ev.order, ev.timeLabel || String(ev.order))
    }
  }
  const timeRows = Array.from(rowMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([order, timeLabel]) => ({ order, timeLabel }))

  const orderToRow = new Map(timeRows.map((r, i) => [r.order, i]))
  const entityToCol = new Map(entities.map((e, i) => [e.id, i]))

  const items: LaidOutEvent[] = []
  for (const event of sortedEvents) {
    const row = orderToRow.get(event.order) ?? 0
    const ids = event.entityIds?.length ? event.entityIds : entities.map((e) => e.id).slice(0, 1)
    for (const entityId of ids) {
      const col = entityToCol.get(entityId)
      if (col == null) continue
      items.push({
        event,
        entityId,
        row,
        col,
        x: config.labelWidth + col * config.colWidth + config.pad,
        y: config.headerHeight + row * config.rowHeight + config.pad,
        color: entityColor.get(entityId) || ENTITY_PALETTE[0],
      })
    }
  }

  const width = config.labelWidth + Math.max(entities.length, 1) * config.colWidth + config.pad
  const height =
    config.headerHeight + Math.max(timeRows.length, 1) * config.rowHeight + config.pad * 2

  return { entities, timeRows, items, width, height, config, entityColor }
}
