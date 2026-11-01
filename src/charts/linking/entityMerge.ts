/**
 * 把「其实是同一个实体」的图表节点合并（如 KKR 与 Kohlberg Kravis Roberts 被模型分成两个节点）。
 * 依据是各章旁路（v3 chapterMeta.entities）里的规范名 + 别名：同一条旁路实体的任一写法
 * 同时精确命中两个图表实体的**全名**，就认为它们是一个。
 *
 * 保守原则：只比全名（不比 `·` 拆出来的片段，避免两个「约翰·X」被误并）；
 * 类型都有且不同的不并；没有任何合并时原样返回同一个引用（保持 memo 稳定）。
 * 纯函数，不依赖 DOM / React。
 */
import type { BookCharts, EntityGraphEdge, EntityGraphNode, TimelineEntity, TimelineEvent } from '../types'
import type { MetaLike } from './entityAliases'

const norm = (s: string) => s.trim().toLowerCase()

interface Ent {
  id: string
  name: string
  type?: string
  importance: number
  order: number
}

export function mergeAliasedEntities(
  charts: BookCharts | null | undefined,
  metas: ReadonlyArray<MetaLike | null | undefined>
): BookCharts | null | undefined {
  if (!charts) return charts
  // 旧字段 personGraph 在反序列化时已归一到 entityGraph
  const graph = charts.entityGraph
  const timeline = charts.entityTimeline

  // 图谱与时间线共用一个 id 命名空间：按 id 汇总，重要度取图谱里的
  const ents = new Map<string, Ent>()
  for (const n of graph?.nodes ?? []) {
    ents.set(n.id, { id: n.id, name: n.name, type: n.type, importance: n.importance ?? 5, order: ents.size })
  }
  for (const e of timeline?.entities ?? []) {
    if (!ents.has(e.id)) ents.set(e.id, { id: e.id, name: e.name, type: e.type, importance: 5, order: ents.size })
  }
  if (ents.size < 2) return charts

  const byName = new Map<string, Ent[]>()
  for (const e of ents.values()) {
    const k = norm(e.name)
    if (k) byName.set(k, [...(byName.get(k) ?? []), e])
  }

  // 并查集：根固定为「重要度最高、同分先出现」的那个，合并后的规范节点
  const parent = new Map<string, string>([...ents.keys()].map((id) => [id, id]))
  const find = (id: string): string => {
    if (!parent.has(id)) return id // 事件里引用了不存在的实体 id：原样保留
    let r = id
    while (parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const better = (a: Ent, b: Ent) => (a.importance !== b.importance ? a.importance > b.importance : a.order < b.order)
  const union = (a: Ent, b: Ent): boolean => {
    if (a.type && b.type && norm(a.type) !== norm(b.type)) return false
    const ra = ents.get(find(a.id))!
    const rb = ents.get(find(b.id))!
    if (ra.id === rb.id) return false
    const [win, lose] = better(ra, rb) ? [ra, rb] : [rb, ra]
    parent.set(lose.id, win.id)
    return true
  }

  let merged = false
  for (const meta of metas) {
    for (const me of meta?.entities ?? []) {
      const hits = new Map<string, Ent>()
      for (const n of [me.name, ...(me.aliases ?? [])]) for (const e of byName.get(norm(n)) ?? []) hits.set(e.id, e)
      const list = [...hits.values()]
      for (let i = 1; i < list.length; i++) merged = union(list[0], list[i]) || merged
    }
  }
  if (!merged) return charts

  const canon = (id: string) => find(id)
  const dedupe = <T,>(items: T[], key: (t: T) => string) => {
    const seen = new Set<string>()
    return items.filter((x) => {
      const k = key(x)
      return seen.has(k) ? false : (seen.add(k), true)
    })
  }

  let entityGraph = charts.entityGraph
  const mergeGraph = (g: { nodes: EntityGraphNode[]; edges: EntityGraphEdge[] }) => {
    // 合并节点：规范节点取自己的字段，缺简介 / 更高重要度时从被并者补
    const groups = new Map<string, EntityGraphNode[]>()
    for (const n of g.nodes) groups.set(canon(n.id), [...(groups.get(canon(n.id)) ?? []), n])
    const nodes: EntityGraphNode[] = []
    for (const [root, members] of groups) {
      const main = members.find((m) => m.id === root) ?? members[0]
      const description = main.description || members.find((m) => m.description)?.description
      const importance = Math.max(...members.map((m) => m.importance ?? 0)) || undefined
      nodes.push({ ...main, id: root, ...(description ? { description } : {}), ...(importance ? { importance } : {}) })
    }
    const edges = dedupe(
      g.edges
        .map((e) => ({ ...e, source: canon(e.source), target: canon(e.target) }))
        .filter((e) => e.source !== e.target),
      (e) => `${e.source}\u0000${e.target}\u0000${e.relation}`
    )
    return { nodes, edges }
  }
  if (entityGraph) entityGraph = mergeGraph(entityGraph)

  let entityTimeline = timeline
  if (timeline) {
    const groups = new Map<string, TimelineEntity[]>()
    for (const e of timeline.entities) groups.set(canon(e.id), [...(groups.get(canon(e.id)) ?? []), e])
    const entities: TimelineEntity[] = [...groups].map(([root, members]) => {
      const main = members.find((m) => m.id === root) ?? members[0]
      const description = main.description || members.find((m) => m.description)?.description
      return { ...main, id: root, ...(description ? { description } : {}) }
    })
    const events: TimelineEvent[] = timeline.events.map((ev) => ({
      ...ev,
      entityIds: dedupe(ev.entityIds.map(canon), (x) => x),
    }))
    entityTimeline = { entities, events }
  }

  return { ...charts, entityGraph, entityTimeline }
}
