/**
 * 联动聚合层（纯函数）：把图表数据 + 章节总结 组合成「谁、什么颜色、在哪几章、哪些事件」的查询表。
 * 图谱 / 时间线 / 人物志 / 关联卡片 / 正文标注都只查这张表，保证口径一致。
 */
import {
  edgeKey,
  getEntityGraph,
  type BookCharts,
  type TimelineEvent,
} from '../types'
import { aliasesFromMetas, type MetaLike } from './entityAliases'
import { buildEntityStyles, type EntityStyle } from './entityColors'
import {
  buildEntityMatcher,
  indexEntityChapters,
  indexEventChapters,
  matchChapterHint,
  type EntityChapterIndex,
  type EntityMatcher,
  type EntityOccurrence,
} from './entityIndex'

export interface LinkChapter {
  id: string
  title: string
  /** 章节总结 Markdown；失败/未处理的章节传空串 */
  text: string
  /** v3 旁路（实体规范名与别名）；没有就不提供 */
  meta?: MetaLike | null
}

/** 卡片/人物志用的实体档案（图谱节点与时间线实体合并） */
export interface EntityProfile {
  id: string
  name: string
  type?: string
  description?: string
  importance?: number
}

/** 关系边 + 它归属的章节集合（多对多；空数组 = 无法判断，按"可能剧透"处理） */
export interface LinkEdge {
  id: string
  /** 与图谱元素共用的稳定键（见 types.edgeKey） */
  key: string
  source: string
  target: string
  relation: string
  description?: string
  chapters: string[]
}

export interface EntityLinking {
  styles: Map<string, EntityStyle>
  profiles: Map<string, EntityProfile>
  matcher: EntityMatcher
  index: EntityChapterIndex
  events: Map<string, TimelineEvent>
  /** 事件 → 章节 id；映射不上为 null（UI 置灰，不猜） */
  eventChapters: Map<string, string | null>
  chapterTitles: Map<string, string>
  /** 章节顺序与下标：剧透判定按下标比较 */
  chapterOrder: string[]
  chapterRank: Map<string, number>
  edges: LinkEdge[]
  /** 实体 → 归属章节集合（chapterHint 优先，缺省取正文出现的章节） */
  entityChapters: Map<string, string[]>
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export function buildEntityLinking(
  charts: BookCharts | null | undefined,
  chapters: readonly LinkChapter[]
): EntityLinking | null {
  if (!charts) return null

  // 第一遍：按重要度定优先级 → 匹配器 → 索引；第二遍用全书出现次数细化同重要度的排序
  const firstPass = buildEntityStyles(charts)
  if (firstPass.size === 0) return null
  const base = [...firstPass.values()].map((s) => ({ id: s.id, name: s.name }))
  const aliases = aliasesFromMetas(base, chapters.map((c) => c.meta))
  const matcher = buildEntityMatcher(base.map((e) => ({ ...e, aliases: aliases.get(e.id) })))
  const index = indexEntityChapters(
    matcher,
    chapters.map((c) => ({ id: c.id, title: c.title, text: c.text }))
  )
  const styles = buildEntityStyles(charts, index.totals)

  const profiles = new Map<string, EntityProfile>()
  for (const n of getEntityGraph(charts)?.nodes ?? []) {
    profiles.set(n.id, {
      id: n.id,
      name: n.name,
      type: n.type,
      description: n.description,
      importance: n.importance,
    })
  }
  for (const e of charts.entityTimeline?.entities ?? []) {
    const prev = profiles.get(e.id)
    profiles.set(e.id, {
      id: e.id,
      name: prev?.name ?? e.name,
      type: prev?.type ?? e.type,
      description: prev?.description || e.description,
      importance: prev?.importance,
    })
  }

  const events = new Map<string, TimelineEvent>()
  for (const ev of charts.entityTimeline?.events ?? []) events.set(ev.id, ev)

  const chapterRefs = chapters.map((c) => ({ id: c.id, title: c.title }))
  const chapterOrder = chapters.map((c) => c.id)
  const chapterRank = new Map(chapterOrder.map((id, i) => [id, i]))
  const byRank = (ids: Iterable<string>) => [...new Set(ids)].sort((a, b) => (chapterRank.get(a) ?? 0) - (chapterRank.get(b) ?? 0))

  // 实体归属章节：AI 给了能映射上的 chapterHint 就以它为准，否则取正文里出现过的章节
  const entityChapters = new Map<string, string[]>()
  const hintOf = new Map<string, string | undefined>()
  for (const n of getEntityGraph(charts)?.nodes ?? []) hintOf.set(n.id, n.chapterHint)
  for (const id of profiles.keys()) {
    const hinted = matchChapterHint(hintOf.get(id), chapterRefs)
    const derived = (index.entityToChapters.get(id) ?? []).map((x) => x.chapterId)
    entityChapters.set(id, hinted ? [hinted] : byRank(derived))
  }

  // 关系边归属章节：chapterHint 优先，否则 = 两端实体共同出现的章节（集合交）
  const edges: LinkEdge[] = (getEntityGraph(charts)?.edges ?? []).map((e, i) => {
    const hinted = matchChapterHint(e.chapterHint, chapterRefs)
    let chapters: string[]
    if (hinted) {
      chapters = [hinted]
    } else {
      const a = new Set((index.entityToChapters.get(e.source) ?? []).map((x) => x.chapterId))
      chapters = byRank((index.entityToChapters.get(e.target) ?? []).map((x) => x.chapterId).filter((c) => a.has(c)))
    }
    return { id: `edge-${i}`, key: edgeKey(e), source: e.source, target: e.target, relation: e.relation, description: e.description, chapters }
  })

  return {
    styles,
    profiles,
    matcher,
    index,
    events,
    eventChapters: indexEventChapters([...events.values()], chapterRefs),
    chapterTitles: new Map(chapters.map((c) => [c.id, c.title])),
    chapterOrder,
    chapterRank,
    edges,
    entityChapters,
  }
}

/** 一组章节里最早的下标；空集合（无法判断）返回 null */
export function earliestRank(l: EntityLinking, chapterIds: readonly string[]): number | null {
  let best: number | null = null
  for (const id of chapterIds) {
    const r = l.chapterRank.get(id)
    if (r !== undefined && (best === null || r < best)) best = r
  }
  return best
}

/** 本章出现的实体 id */
export function chapterEntityIds(l: EntityLinking | null, chapterId: string): ReadonlySet<string> {
  return l?.index.chapterToEntities.get(chapterId) ?? EMPTY_SET
}

/** 映射到本章的时间线事件 id */
export function chapterEventIds(l: EntityLinking | null, chapterId: string): ReadonlySet<string> {
  if (!l || !chapterId) return EMPTY_SET
  const out = new Set<string>()
  for (const [eventId, ch] of l.eventChapters) if (ch === chapterId) out.add(eventId)
  return out
}

/** 实体出现在哪些章节（带标题与次数），用于卡片与图谱详情 */
export function entityChapterList(
  l: EntityLinking | null,
  entityId: string
): { chapterId: string; title: string; count: number }[] {
  if (!l) return []
  return (l.index.entityToChapters.get(entityId) ?? []).map((x) => ({
    chapterId: x.chapterId,
    title: l.chapterTitles.get(x.chapterId) ?? x.chapterId,
    count: x.count,
  }))
}

export function entityOccurrencesIn(
  l: EntityLinking | null,
  entityId: string,
  chapterId: string
): EntityOccurrence[] {
  return (l?.index.occurrences.get(entityId) ?? []).filter((o) => o.chapterId === chapterId)
}

/** 实体参与的时间线事件（按叙事顺序） */
export function eventsOfEntity(l: EntityLinking | null, entityId: string): TimelineEvent[] {
  if (!l) return []
  return [...l.events.values()].filter((e) => e.entityIds.includes(entityId)).sort((a, b) => a.order - b.order)
}

/**
 * 「下一次出现」：优先当前章之后的第一次，没有则回到全书第一次。
 * 供双击快捷跳转使用；currentChapterId 为空视为从头开始。
 */
export function nextOccurrence(
  l: EntityLinking | null,
  entityId: string,
  currentChapterId: string | undefined,
  chapterOrder: readonly string[]
): EntityOccurrence | null {
  const all = l?.index.occurrences.get(entityId)
  if (!all?.length) return null
  const rank = new Map(chapterOrder.map((id, i) => [id, i]))
  const cur = currentChapterId ? (rank.get(currentChapterId) ?? -1) : -1
  return all.find((o) => (rank.get(o.chapterId) ?? -1) > cur) ?? all[0]
}
