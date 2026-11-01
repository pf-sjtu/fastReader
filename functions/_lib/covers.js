// 书封面 / 元数据的云端存储（Workers KV）。
//
// 为什么放 KV：书库有 600+ 本书，原先靠「下载整本书再解析封面」补全，要拉几个 GB；
// 把压缩后的封面（~3-6KB）与元数据放进 KV，书库首屏只读一份索引 + 可见的几张封面。
//
// 键：
//   covers:index   JSON {items: {[id]: {stem,title,author,pages,chapterCount,cover}}}   一份索引（~100KB 量级）
//   cover:<id>     base64 文本（webp，≤48KB）
// KV 免费额度写 1000 次/天：批量接口一次请求写 N 张封面 + 1 次索引，单本补传也是 2 次写。
import { getKv } from './kv.js'

export const INDEX_KEY = 'covers:index'
export const MAX_IMAGE_BYTES = 48 * 1024
export const MAX_BULK_ITEMS = 40
export const MAX_BODY_BYTES = 1.5 * 1024 * 1024

/** 书 id：`bk_` + 64 位 FNV-1a 的 base36（由书名主干归一后计算，前端 / 脚本同一实现，见 tests/fixtures/book-id-cases.json） */
export const ID_RE = /^bk_[0-9a-z]{6,16}$/

export const coverKey = (id) => `cover:${id}`

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const int = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Math.round(Number(v)), 100000) : undefined)

/** 元数据清洗：只留已知字段并限长（客户端不可信） */
export function cleanMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {}
  const out = { stem: str(m.stem, 240), title: str(m.title, 240) }
  const author = str(m.author, 120)
  if (author) out.author = author
  const pages = int(m.pages)
  if (pages) out.pages = pages
  const chapterCount = int(m.chapterCount)
  if (chapterCount) out.chapterCount = chapterCount
  return out
}

export async function readIndex(env) {
  const raw = await getKv(env).get(INDEX_KEY)
  if (!raw) return { items: {} }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed.items === 'object' && parsed.items ? { items: parsed.items } : { items: {} }
  } catch {
    return { items: {} }
  }
}

/** base64 → 字节数（不解码，按长度推算），用来在写入前拒绝过大的图片 */
export function base64Bytes(b64) {
  const s = String(b64 || '').replace(/=+$/, '')
  return Math.floor((s.length * 3) / 4)
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * 写入一批条目：{id, meta, image?}（image 为 base64 webp；缺省 = 只更新元数据）。
 * 返回逐条结果；索引只写一次。已存在的封面不覆盖（除非 overwrite），脚本重跑不会白白烧写入额度。
 */
export async function putItems(env, items, { overwrite = false } = {}) {
  const kv = getKv(env)
  const index = await readIndex(env)
  const results = []
  let dirty = false
  for (const it of items) {
    const id = it?.id
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      results.push({ id: String(id), status: 'bad_id' })
      continue
    }
    const meta = cleanMeta(it.meta)
    const prev = index.items[id]
    let hasCover = !!prev?.cover
    let status = 'meta'
    if (typeof it.image === 'string' && it.image) {
      if (!B64_RE.test(it.image) || base64Bytes(it.image) > MAX_IMAGE_BYTES) {
        results.push({ id, status: 'bad_image' })
        continue
      }
      if (hasCover && !overwrite) {
        status = 'exists'
      } else {
        await kv.put(coverKey(id), it.image)
        hasCover = true
        status = 'stored'
      }
    }
    const next = { ...(prev ?? {}), ...meta, ...(hasCover ? { cover: 1 } : {}) }
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      index.items[id] = next
      dirty = true
    }
    results.push({ id, status })
  }
  if (dirty) await kv.put(INDEX_KEY, JSON.stringify(index))
  return results
}

export async function readCover(env, id) {
  return getKv(env).get(coverKey(id))
}
