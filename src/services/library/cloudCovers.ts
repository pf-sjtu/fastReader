/**
 * 云端封面 / 元数据（Cloudflare KV，经 /api/covers）的客户端。
 *
 * 流程：书库刷新后读一份索引（~100KB）→ 书名主干匹配（先 id 精确，再模糊）→ 命中的书直接拿到封面键与元数据，
 * 不再逐本下载解析；没命中的书由用户点开（下载）后解析并补传，下一次谁都能直接命中。
 */
import { bookIdOf, bookStem, normalizeStem } from './bookId'

export interface CoverItem {
  stem: string
  title: string
  author?: string
  pages?: number
  chapterCount?: number
  cover?: 1
}
export type CoverIndex = Record<string, CoverItem>

export const CLOUD_COVER_PREFIX = 'bk_'
export const isCloudCoverKey = (key: string | undefined): key is string => !!key && key.startsWith(CLOUD_COVER_PREFIX)
export const cloudCoverUrl = (id: string) => `/api/covers/${id}`

type FetchLike = typeof fetch

/** 读云端索引；任何失败都返回空索引（书库照常工作，只是没有云端封面） */
export async function fetchCoverIndex(fetchImpl: FetchLike = fetch): Promise<CoverIndex> {
  try {
    const r = await fetchImpl('/api/covers', { credentials: 'same-origin' })
    if (!r.ok) return {}
    const data = (await r.json()) as { items?: CoverIndex }
    return data?.items && typeof data.items === 'object' ? data.items : {}
  } catch {
    return {}
  }
}

export async function fetchCoverBlob(id: string, fetchImpl: FetchLike = fetch): Promise<Blob | null> {
  try {
    const r = await fetchImpl(cloudCoverUrl(id), { credentials: 'same-origin' })
    if (!r.ok) return null
    const blob = await r.blob()
    return blob.size > 0 ? new Blob([blob], { type: 'image/webp' }) : null
  } catch {
    return null
  }
}

/** 上传一张封面（可选）与元数据；失败只返回 false，由调用方决定是否忽略 */
export async function uploadCover(id: string, meta: Omit<CoverItem, 'cover'>, blob: Blob, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(cloudCoverUrl(id), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'image/webp', 'X-Book-Meta': encodeURIComponent(JSON.stringify(meta)) },
      body: blob,
    })
    return r.ok
  } catch {
    return false
  }
}

/** 字符二元组 Dice 系数（0–1）：对「少几个字 / 多个括号后缀」这类差异不敏感 */
export function dice(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const ga = grams(a)
  const gb = grams(b)
  let hit = 0
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0)
  return (2 * hit) / (a.length - 1 + (b.length - 1))
}

export const FUZZY_MIN = 0.86
/** 最佳匹配必须明显优于第二名，否则宁可不配（把别的书的封面贴上去比没有封面更糟） */
export const FUZZY_MARGIN = 0.06

/** 书文件路径 → 云端 id：先精确（同名书），再在索引里模糊找；找不到或有歧义返回 null */
export function matchCoverId(path: string, index: CoverIndex, norm: Map<string, string> = buildNormIndex(index)): string | null {
  const exact = bookIdOf(path)
  if (index[exact]) return exact
  const target = normalizeStem(bookStem(path))
  if (target.length < 4) return null
  let best: { id: string; score: number } | null = null
  let second = 0
  for (const [id, stem] of norm) {
    const score = dice(target, stem)
    if (!best || score > best.score) {
      if (best) second = Math.max(second, best.score)
      best = { id, score }
    } else if (score > second) second = score
  }
  return best && best.score >= FUZZY_MIN && best.score - second >= FUZZY_MARGIN ? best.id : null
}

/** id → 归一后的书名主干（模糊匹配用；预先算好避免每本书都重复归一整份索引） */
export function buildNormIndex(index: CoverIndex): Map<string, string> {
  return new Map(Object.entries(index).map(([id, it]) => [id, normalizeStem(it.stem || it.title || '')]))
}
