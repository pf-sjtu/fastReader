/**
 * 书架组织：分组（分类）与乱序推荐。纯函数，推荐用带种子的 PRNG，结果可复现、可测试。
 */
import type { LibraryEntry, LibraryIndex } from './types'

export type GroupBy = 'none' | 'status' | 'format' | 'author' | 'folder'

export interface BookGroup {
  /** 稳定键：用于 React key 与折叠状态记忆 */
  key: string
  entries: LibraryEntry[]
}

/** 分组键：在 UI 里再翻译成文案（这里只给稳定的内部键，不含语言） */
export function groupKeyOf(e: LibraryEntry, by: Exclude<GroupBy, 'none'>): string {
  switch (by) {
    case 'status':
      return e.readProgress && e.status !== 'done' && e.readProgress.pct > 0 ? 'reading' : e.status
    case 'format':
      return (e.path.split('.').pop() ?? 'other').toLowerCase()
    case 'author':
      return e.author ? `a:${e.author}` : 'unknown'
    case 'folder': {
      const parts = e.path.split('/').filter(Boolean)
      // 同步目录下的直接文件归 root；子目录取其直接父目录名
      return parts.length > 2 ? `d:${parts[parts.length - 2]}` : 'root'
    }
  }
}

const GROUP_ORDER: Record<string, number> = { reading: 0, partial: 1, unprocessed: 2, done: 3, epub: 0, pdf: 1, txt: 2, md: 3, root: 0, unknown: 9999 }

/**
 * 分组，组内保持传入顺序（调用方先排序）。组顺序：固定语义的键按 GROUP_ORDER，
 * 其余（作者/目录名）按书数量降序、再按名称；「未知作者」永远最后。
 */
export function groupEntries(entries: readonly LibraryEntry[], by: GroupBy): BookGroup[] {
  if (by === 'none') return entries.length ? [{ key: 'all', entries: [...entries] }] : []
  const map = new Map<string, LibraryEntry[]>()
  for (const e of entries) {
    const k = groupKeyOf(e, by)
    const list = map.get(k)
    if (list) list.push(e)
    else map.set(k, [e])
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, entries: list }))
    .sort((a, b) => {
      const oa = GROUP_ORDER[a.key]
      const ob = GROUP_ORDER[b.key]
      if (oa !== undefined || ob !== undefined) return (oa ?? 500) - (ob ?? 500) || b.entries.length - a.entries.length
      return b.entries.length - a.entries.length || a.key.localeCompare(b.key, 'zh')
    })
}

/* ---------------- 乱序推荐 ---------------- */

export type RecommendReason = 'resume' | 'sameAuthor' | 'fresh' | 'retry' | 'revisit'

export interface Recommendation {
  entry: LibraryEntry
  reason: RecommendReason
}

/** mulberry32：体积小、分布够用的种子 PRNG */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Weighted {
  entry: LibraryEntry
  weight: number
  reason: RecommendReason
}

/** 各候选的权重与理由。读完的书不推荐；越"接着读/新鲜/同作者"权重越高 */
function weigh(index: LibraryIndex): Weighted[] {
  const all = Object.values(index.entries)
  // 最近读过的作者：同作者的书加权（元数据利用）
  const favouredAuthors = new Set(
    all
      .filter((e) => e.lastOpenedAt && e.author)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .slice(0, 3)
      .map((e) => e.author!)
  )
  const out: Weighted[] = []
  for (const e of all) {
    const pct = e.readProgress?.pct ?? 0
    if (e.status === 'done' && pct >= 100) continue
    let weight: number
    let reason: RecommendReason
    if (e.status !== 'unprocessed' && pct > 0) {
      // 读到一半的书应该几乎必现：权重远高于其它类别（实测 5 时命中率仅 ~17%）
      weight = 20
      reason = 'resume'
    } else if (!e.lastOpenedAt && e.status === 'unprocessed') {
      weight = 3
      reason = 'fresh'
    } else if (e.status === 'unprocessed') {
      weight = 2
      reason = 'retry'
    } else {
      weight = 1.5
      reason = 'revisit'
    }
    if (e.author && favouredAuthors.has(e.author) && reason !== 'resume') {
      weight *= 1.6
      reason = 'sameAuthor'
    }
    out.push({ entry: e, weight, reason })
  }
  return out
}

export interface RecommendOptions {
  seed: number
  count?: number
  /** 上一批的路径：「换一批」时尽量避开（候选不够时才允许重复） */
  exclude?: readonly string[]
}

/**
 * 加权无放回随机抽样。同一 seed + 同一书库 → 同一结果；换 seed 即「换一批」。
 * 候选少于 count 时全部返回；避开上一批后不足 count 才回填上一批的书。
 */
export function recommendBooks(index: LibraryIndex, { seed, count = 6, exclude = [] }: RecommendOptions): Recommendation[] {
  const rand = seededRandom(seed)
  const skip = new Set(exclude)
  const pick = (pool: Weighted[], n: number): Weighted[] => {
    const rest = [...pool].sort((a, b) => a.entry.path.localeCompare(b.entry.path)) // 先定序，保证只由 seed 决定
    const chosen: Weighted[] = []
    while (chosen.length < n && rest.length) {
      const total = rest.reduce((s, w) => s + w.weight, 0)
      let r = rand() * total
      let i = 0
      for (; i < rest.length - 1; i++) {
        r -= rest[i].weight
        if (r <= 0) break
      }
      chosen.push(rest.splice(i, 1)[0])
    }
    return chosen
  }
  const all = weigh(index)
  const fresh = all.filter((w) => !skip.has(w.entry.path))
  let chosen = pick(fresh, count)
  if (chosen.length < count) chosen = chosen.concat(pick(all.filter((w) => skip.has(w.entry.path)), count - chosen.length))
  return chosen.map(({ entry, reason }) => ({ entry, reason }))
}

