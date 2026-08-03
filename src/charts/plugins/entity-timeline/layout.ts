import type { EntityTimeline, TimelineEntity, TimelineEvent } from '../../types'
import { wrapText, maxUnitsForWidth } from '../../textWrap'

/** 回退色板（无主题时）；优先由调用方注入 theme.palette */
export const ENTITY_PALETTE = [
  'oklch(0.45 0.06 65)',
  'oklch(0.48 0.08 30)',
  'oklch(0.42 0.05 85)',
  'oklch(0.50 0.07 45)',
  'oklch(0.40 0.04 75)',
  'oklch(0.46 0.06 20)',
  'oklch(0.44 0.05 100)',
  'oklch(0.47 0.07 15)',
  'oklch(0.43 0.04 55)',
  'oklch(0.49 0.06 35)',
  'oklch(0.41 0.05 90)',
  'oklch(0.46 0.08 25)',
]

export interface TimelineLayoutConfig {
  /** 列宽（色块区域） */
  colWidth: number
  labelWidth: number
  headerHeight: number
  pad: number
  fontSize: number
  lineHeight: number
  /** 行最小高度 */
  minRowHeight: number
  /** 可选主题色板 */
  palette?: string[]
}

export const DEFAULT_LAYOUT: TimelineLayoutConfig = {
  colWidth: 128,
  labelWidth: 100,
  headerHeight: 48,
  pad: 8,
  fontSize: 11,
  lineHeight: 15,
  minRowHeight: 48,
}

export interface LaidOutEvent {
  event: TimelineEvent
  entityId: string
  row: number
  col: number
  x: number
  y: number
  color: string
  /** 换行后的标签行 */
  labelLines: string[]
  chipHeight: number
  chipWidth: number
}

export interface TimelineLayoutResult {
  entities: TimelineEntity[]
  timeRows: { order: number; timeLabel: string; labelLines: string[]; height: number; y: number }[]
  items: LaidOutEvent[]
  width: number
  height: number
  config: TimelineLayoutConfig
  entityColor: Map<string, string>
  headerLines: Map<string, string[]>
}

function chipInnerWidth(config: TimelineLayoutConfig): number {
  return config.colWidth - config.pad * 2
}

function linesHeight(lines: string[], config: TimelineLayoutConfig): number {
  const n = Math.max(1, lines.length)
  return n * config.lineHeight + config.pad * 2
}

/**
 * 纵轴=时间/order，横轴=实体列；行高随文字换行自适应
 */
export function layoutEntityTimeline(
  data: EntityTimeline,
  config: TimelineLayoutConfig = DEFAULT_LAYOUT
): TimelineLayoutResult {
  const palette = config.palette?.length ? config.palette : ENTITY_PALETTE
  const entities = data.entities?.length
    ? data.entities
    : Array.from(new Set(data.events.flatMap((e) => e.entityIds || []))).map((id) => ({
        id,
        name: id,
      }))

  const entityColor = new Map<string, string>()
  entities.forEach((ent, i) => {
    entityColor.set(ent.id, ent.color || palette[i % palette.length])
  })

  const chipW = chipInnerWidth(config)
  const maxUnits = maxUnitsForWidth(chipW - 8, config.fontSize)
  const labelMaxUnits = maxUnitsForWidth(config.labelWidth - 10, config.fontSize - 1)

  const headerLines = new Map<string, string[]>()
  let headerH = config.headerHeight
  for (const ent of entities) {
    const lines = wrapText(ent.name, maxUnitsForWidth(chipW, config.fontSize))
    headerLines.set(ent.id, lines)
    headerH = Math.max(headerH, linesHeight(lines, config))
  }

  const sortedEvents = [...(data.events || [])].sort((a, b) => a.order - b.order)

  const rowMap = new Map<number, string>()
  for (const ev of sortedEvents) {
    if (!rowMap.has(ev.order)) {
      rowMap.set(ev.order, ev.timeLabel || String(ev.order))
    }
  }
  const orders = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0])

  // 预计算每行事件标签行数 → 行高
  const orderToEvents = new Map<number, TimelineEvent[]>()
  for (const ev of sortedEvents) {
    const list = orderToEvents.get(ev.order) || []
    list.push(ev)
    orderToEvents.set(ev.order, list)
  }

  const timeRows: TimelineLayoutResult['timeRows'] = []
  let yCursor = headerH
  for (const [order, timeLabel] of orders) {
    const timeLines = wrapText(timeLabel, labelMaxUnits)
    let rowH = Math.max(config.minRowHeight, linesHeight(timeLines, { ...config, pad: 6 }))
    for (const ev of orderToEvents.get(order) || []) {
      const labelLines = wrapText(ev.label, maxUnits)
      rowH = Math.max(rowH, linesHeight(labelLines, config))
    }
    timeRows.push({
      order,
      timeLabel,
      labelLines: timeLines,
      height: rowH,
      y: yCursor,
    })
    yCursor += rowH
  }

  const orderToRowMeta = new Map(timeRows.map((r, i) => [r.order, { ...r, rowIndex: i }]))
  const entityToCol = new Map(entities.map((e, i) => [e.id, i]))

  const items: LaidOutEvent[] = []
  for (const event of sortedEvents) {
    const meta = orderToRowMeta.get(event.order)
    if (!meta) continue
    const labelLines = wrapText(event.label, maxUnits)
    const chipHeight = Math.min(
      meta.height - config.pad,
      Math.max(config.minRowHeight - config.pad, linesHeight(labelLines, config))
    )
    const ids = event.entityIds?.length
      ? event.entityIds
      : entities.map((e) => e.id).slice(0, 1)
    for (const entityId of ids) {
      const col = entityToCol.get(entityId)
      if (col == null) continue
      items.push({
        event,
        entityId,
        row: meta.rowIndex,
        col,
        x: config.labelWidth + col * config.colWidth + config.pad,
        y: meta.y + config.pad / 2,
        color: entityColor.get(entityId) || palette[0],
        labelLines,
        chipHeight,
        chipWidth: chipW,
      })
    }
  }

  const width =
    config.labelWidth + Math.max(entities.length, 1) * config.colWidth + config.pad
  const height = yCursor + config.pad

  return {
    entities,
    timeRows,
    items,
    width,
    height,
    config: { ...config, headerHeight: headerH },
    entityColor,
    headerLines,
  }
}
