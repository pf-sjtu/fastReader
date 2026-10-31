/**
 * 实体卡片的数据模型（纯函数）：关系概括 + 重要事件 + 防剧透折叠。
 *
 * 剧透规则：设当前章下标为 c，信息项最早归属章下标为 e。
 *   e < c → 默认可见；e ≥ c 或无法判断（null）→ 默认折叠。宁可多折叠，不赌"应该没事"。
 * 关键：reveal=false 时，被折叠的内容**不会出现在返回值里**（只给条数）。
 * 折叠不是"渲染了再隐藏"，否则文字仍在 DOM 里，可被复制、被读屏念出、被 DevTools 看到。
 */
import {
  earliestRank,
  entityChapterList,
  eventsOfEntity,
  type EntityLinking,
  type LinkEdge,
} from './entityLinking'

export const CARD_MAX_RELATION_GROUPS = 6
export const CARD_MAX_EVENTS = 5
/** 展开后最多显示的条目（防止极端数据撑爆卡片） */
export const CARD_MAX_REVEALED = 20

export interface CardNeighbor {
  id: string
  name: string
}

export interface CardRelationGroup {
  key: string
  relation: string
  /** out：本实体 → 邻居；in：邻居 → 本实体 */
  direction: 'out' | 'in'
  neighbors: CardNeighbor[]
  /** 该组里最早归属的章节（展开剧透后用来标注"第 9 章"）；无法判断为 null */
  firstChapterId: string | null
}

export interface CardEvent {
  id: string
  label: string
  timeLabel: string
  chapterId: string | null
}

export interface CardAppearance {
  chapterId: string
  title: string
  /** 该章出现次数 */
  count: number
}

export interface CardSection {
  description?: string
  relations: CardRelationGroup[]
  /** 可见但因数量上限没有显示的关系条数 */
  moreRelations: number
  events: CardEvent[]
  moreEvents: number
  /** 「在正文出现」的章节列表 */
  appearances: CardAppearance[]
}

export interface EntityCardModel {
  entityId: string
  name: string
  type?: string
  /** 实体最早归属章节（无法判断为 null） */
  firstChapterId: string | null
  /** 实体最早就在当前章出场：简介/关系/事件都应折叠 */
  firstAppearsHere: boolean
  visible: CardSection
  hidden: { description: number; relations: number; events: number; appearances: number; total: number }
  /** 仅 reveal=true 时给出：被折叠的内容，带章节归属 */
  revealed: CardSection | null
}

interface EdgeItem {
  edge: LinkEdge
  other: string
  direction: 'out' | 'in'
  rank: number | null
}

export function isVisibleRank(rank: number | null, currentRank: number): boolean {
  return rank !== null && rank < currentRank
}

function groupRelations(l: EntityLinking, items: EdgeItem[]): CardRelationGroup[] {
  const importance = (id: string) => l.profiles.get(id)?.importance ?? 0
  const groups = new Map<string, { relation: string; direction: 'out' | 'in'; ids: Set<string>; rank: number | null }>()
  for (const it of items) {
    const key = `${it.direction}|${it.edge.relation}`
    const g = groups.get(key) ?? { relation: it.edge.relation, direction: it.direction, ids: new Set<string>(), rank: null }
    g.ids.add(it.other)
    if (it.rank !== null && (g.rank === null || it.rank < g.rank)) g.rank = it.rank
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const neighbors = [...g.ids]
        .map((id) => ({ id, name: l.profiles.get(id)?.name ?? l.styles.get(id)?.name ?? id }))
        .sort((a, b) => importance(b.id) - importance(a.id) || a.name.localeCompare(b.name, 'zh'))
      return {
        key,
        relation: g.relation,
        direction: g.direction,
        neighbors,
        firstChapterId: g.rank === null ? null : (l.chapterOrder[g.rank] ?? null),
        _score: importance(neighbors[0]?.id ?? ''),
      }
    })
    .sort((a, b) => b._score - a._score || b.neighbors.length - a.neighbors.length || a.relation.localeCompare(b.relation, 'zh'))
    .map(({ _score, ...rest }) => {
      void _score
      return rest
    })
}

function eventItems(l: EntityLinking, entityId: string) {
  return eventsOfEntity(l, entityId).map((ev) => {
    const chapterId = l.eventChapters.get(ev.id) ?? null
    const rank = chapterId ? (l.chapterRank.get(chapterId) ?? null) : null
    return { event: { id: ev.id, label: ev.label, timeLabel: ev.timeLabel, chapterId } as CardEvent, rank }
  })
}

/**
 * @param currentChapterId 当前章（悬停时取标注所在章；图谱/时间线取当前阅读章）。未知时按最保守处理：一切折叠。
 * @param reveal 用户点了"展开"：把被折叠的内容也放进 revealed
 */
export function buildEntityCardModel(
  l: EntityLinking | null,
  entityId: string,
  currentChapterId: string | undefined,
  reveal = false
): EntityCardModel | null {
  if (!l) return null
  const profile = l.profiles.get(entityId)
  const style = l.styles.get(entityId)
  if (!profile && !style) return null

  const curRank = currentChapterId ? (l.chapterRank.get(currentChapterId) ?? 0) : 0
  const entRank = earliestRank(l, l.entityChapters.get(entityId) ?? [])
  const firstChapterId = entRank === null ? null : (l.chapterOrder[entRank] ?? null)

  // ---- 关系 ----
  const items: EdgeItem[] = []
  for (const edge of l.edges) {
    if (edge.source !== entityId && edge.target !== entityId) continue
    const out = edge.source === entityId
    items.push({ edge, other: out ? edge.target : edge.source, direction: out ? 'out' : 'in', rank: earliestRank(l, edge.chapters) })
  }
  const visibleEdges = items.filter((i) => isVisibleRank(i.rank, curRank))
  const hiddenEdges = items.filter((i) => !isVisibleRank(i.rank, curRank))
  const visibleGroups = groupRelations(l, visibleEdges)

  // ---- 事件 ----
  const evs = eventItems(l, entityId)
  const visibleEvents = evs.filter((e) => isVisibleRank(e.rank, curRank)).map((e) => e.event)
  const hiddenEvents = evs.filter((e) => !isVisibleRank(e.rank, curRank)).map((e) => e.event)
  const shownEvents = visibleEvents.slice(-CARD_MAX_EVENTS) // 取最近的几条（紧挨着当前章的最有用）

  const descHidden = !!profile?.description && !isVisibleRank(entRank, curRank)

  // 「在正文出现」本身也是剧透途径（"出现在第 20 章"）：本章及之前可见（本章正文就在屏幕上），之后折叠。
  // 当前章未知时一律折叠。
  const hasCurrent = !!currentChapterId && l.chapterRank.has(currentChapterId)
  const appearances = entityChapterList(l, entityId)
  const visibleApps = appearances.filter((a) => hasCurrent && (l.chapterRank.get(a.chapterId) ?? Infinity) <= curRank)
  const hiddenApps = appearances.filter((a) => !visibleApps.includes(a))

  const visible: CardSection = {
    description: !descHidden ? profile?.description : undefined,
    relations: visibleGroups.slice(0, CARD_MAX_RELATION_GROUPS),
    moreRelations: visibleGroups.slice(CARD_MAX_RELATION_GROUPS).reduce((n, g) => n + g.neighbors.length, 0),
    events: shownEvents,
    moreEvents: visibleEvents.length - shownEvents.length,
    appearances: visibleApps,
  }

  const hidden = {
    description: descHidden ? 1 : 0,
    relations: hiddenEdges.length,
    events: hiddenEvents.length,
    appearances: hiddenApps.length,
    total: (descHidden ? 1 : 0) + hiddenEdges.length + hiddenEvents.length + hiddenApps.length,
  }

  const revealed: CardSection | null = reveal
    ? {
        description: descHidden ? profile?.description : undefined,
        relations: groupRelations(l, hiddenEdges).slice(0, CARD_MAX_REVEALED),
        moreRelations: 0,
        events: hiddenEvents.slice(0, CARD_MAX_REVEALED),
        moreEvents: Math.max(0, hiddenEvents.length - CARD_MAX_REVEALED),
        appearances: hiddenApps,
      }
    : null

  return {
    entityId,
    name: profile?.name ?? style?.name ?? entityId,
    type: profile?.type ?? style?.type,
    firstChapterId,
    firstAppearsHere: entRank !== null && entRank === curRank && !!currentChapterId,
    visible,
    hidden,
    revealed,
  }
}
