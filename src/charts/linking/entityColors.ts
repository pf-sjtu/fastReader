/**
 * 实体配色：图谱节点与时间线实体同属一个 id 命名空间（见 schema.ts），
 * 合并后统一分配颜色与形状，所有视图只查这张表，保证"同一实体处处同色"。
 */
import { getEntityGraph, type BookCharts } from '../types'

/** index.css 中 --entity-1..N 的数量 */
export const ENTITY_SLOT_COUNT = 10

export type EntityShape = 'circle' | 'round-rect' | 'diamond'

export interface EntityStyle {
  id: string
  name: string
  type?: string
  /** 1..ENTITY_SLOT_COUNT；null 表示落入中性色 */
  slot: number | null
  /** 可直接用于 CSS：var(--entity-3) / var(--entity-neutral) */
  cssVar: string
  shape: EntityShape
}

const PERSON_HINTS = ['人物', '人', '角色', 'person', 'people', 'character', 'individual']
const ORG_HINTS = ['组织', '机构', '公司', '团体', '集团', '政府', '部门', 'org', 'company', 'institution', 'group', 'team']

/** 类型 → 形状：人物=圆，组织=圆角方，其余（概念/事件/理论等）=菱形；无类型视为人物 */
export function shapeForType(type?: string): EntityShape {
  const t = (type || '').trim().toLowerCase()
  if (!t) return 'circle'
  if (ORG_HINTS.some((h) => t.includes(h))) return 'round-rect'
  if (PERSON_HINTS.some((h) => t.includes(h))) return 'circle'
  return 'diamond'
}

export function slotCssVar(slot: number | null): string {
  return slot ? `var(--entity-${slot})` : 'var(--entity-neutral)'
}

interface Candidate {
  id: string
  name: string
  type?: string
  importance: number
  weight: number
}

/**
 * @param occurrences 可选：实体 id → 在章节总结中的出场次数（由 entityIndex 计算），用于同 importance 时排序
 */
export function buildEntityStyles(
  charts: BookCharts | null | undefined,
  occurrences?: ReadonlyMap<string, number>
): Map<string, EntityStyle> {
  const styles = new Map<string, EntityStyle>()
  if (!charts) return styles

  const byId = new Map<string, Candidate>()
  const upsert = (id: string, name: string, type: string | undefined, importance: number) => {
    const prev = byId.get(id)
    if (prev) {
      prev.importance = Math.max(prev.importance, importance)
      prev.type = prev.type || type
      return
    }
    byId.set(id, { id, name, type, importance, weight: occurrences?.get(id) ?? 0 })
  }

  for (const n of getEntityGraph(charts)?.nodes ?? []) {
    upsert(n.id, n.name, n.type, n.importance ?? 0)
  }
  for (const e of charts.entityTimeline?.entities ?? []) {
    upsert(e.id, e.name, e.type, 0)
  }
  for (const ev of charts.entityTimeline?.events ?? []) {
    for (const id of ev.entityIds) {
      const c = byId.get(id)
      if (c) c.weight += 1
    }
  }

  const ranked = [...byId.values()].sort(
    (a, b) =>
      b.importance - a.importance ||
      b.weight - a.weight ||
      a.name.localeCompare(b.name, 'zh') ||
      a.id.localeCompare(b.id)
  )

  ranked.forEach((c, i) => {
    const slot = i < ENTITY_SLOT_COUNT ? i + 1 : null
    styles.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type,
      slot,
      cssVar: slotCssVar(slot),
      shape: shapeForType(c.type),
    })
  })
  return styles
}
