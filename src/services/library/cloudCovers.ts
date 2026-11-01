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
  /** 源文件名（含扩展名）与字节数：书架显示格式 / 点开后判断书是否变了 */
  file?: string
  size?: number
  subjects?: string[]
  desc?: string
  publisher?: string
  year?: number
  lang?: string
  cover?: 1
  updatedAt?: number
  /** 封面最近一次被写入的时间（服务端维护）：换封面后其他设备据此让本地缓存失效；老条目没有 */
  coverAt?: number
}
export type CoverIndex = Record<string, CoverItem>
/** 写入时提交的元数据（cover / updatedAt 由服务端维护） */
export type CoverMeta = Omit<CoverItem, 'cover' | 'updatedAt'>

export const CLOUD_COVER_PREFIX = 'bk_'
export const isCloudCoverKey = (key: string | undefined): key is string => !!key && key.startsWith(CLOUD_COVER_PREFIX)
/**
 * 云端封面的键：`<id>` 或 `<id>@<coverAt>`。带版本的键同时是本地缓存键，封面被替换（coverAt 变了）后
 * 旧缓存自然失效；没有 coverAt 的老条目沿用纯 id，已有的本地缓存不受影响。
 */
export const cloudCoverKey = (id: string, it?: Pick<CoverItem, 'coverAt'>) => (it?.coverAt ? `${id}@${it.coverAt}` : id)
export const parseCloudCoverKey = (key: string): { id: string; v?: string } => {
  const [id, v] = key.split('@')
  return { id, v: v || undefined }
}
/** v 只用来绕开浏览器对「不可变」封面的 24 小时缓存，服务端忽略它 */
export const cloudCoverUrl = (id: string, v?: string) => `/api/covers/${id}${v ? `?v=${encodeURIComponent(v)}` : ''}`

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

export async function fetchCoverBlob(id: string, fetchImpl: FetchLike = fetch, v?: string): Promise<Blob | null> {
  try {
    const r = await fetchImpl(cloudCoverUrl(id, v), { credentials: 'same-origin' })
    if (!r.ok) return null
    const blob = await r.blob()
    return blob.size > 0 ? new Blob([blob], { type: 'image/webp' }) : null
  } catch {
    return null
  }
}

/**
 * 上传元数据与（可选）封面；失败只返回 false，由调用方决定是否忽略。
 * blob 缺省 = 只更新元数据；replace = 源文件变了，用新封面覆盖旧的。
 */
export async function uploadCover(
  id: string,
  meta: CoverMeta,
  blob?: Blob | null,
  fetchImpl: FetchLike = fetch,
  opts: { replace?: boolean } = {}
): Promise<boolean> {
  try {
    const r = await fetchImpl(cloudCoverUrl(id) + (opts.replace ? '?replace=1' : ''), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'image/webp', 'X-Book-Meta': encodeURIComponent(JSON.stringify(meta)) },
      body: blob ?? undefined,
    })
    return r.ok
  } catch {
    return false
  }
}

/** 删除云端书目条目（封面 + 元数据）。只在用户确认「WebDAV 上已找不到」后调用；返回成功删除（含本来就不存在）的 id */
export async function deleteCovers(ids: readonly string[], fetchImpl: FetchLike = fetch): Promise<string[]> {
  const done: string[] = []
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH)
    try {
      const r = await fetchImpl('/api/covers/delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      })
      if (!r.ok) continue
      const { results } = (await r.json()) as { results: { id: string; status: string }[] }
      for (const x of results) if (x.status === 'deleted') done.push(x.id)
    } catch {
      /* 这一批失败：留在云端，用户下次还会看到提示 */
    }
  }
  return done
}
const DELETE_BATCH = 200

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
