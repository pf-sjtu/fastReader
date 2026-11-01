// 书封面 / 元数据的云端存储（Workers KV）。
//
// 为什么放 KV：书库有 600+ 本书，原先靠「下载整本书再解析封面」补全，要拉几个 GB；
// 把压缩后的封面（~2-3KB）与元数据放进 KV，书库首屏只读一份索引 + 可见的几张封面。
//
// 键：
//   covers:index   JSON {rev, items: {[id]: {stem,title,author,pages,chapterCount,file,size,subjects,desc,publisher,year,lang,cover,updatedAt}}}   一份索引（646 本约 650KB）
//   cover:<id>     base64 文本（webp，≤48KB）
// KV 免费额度写 1000 次/天：批量接口一次请求写 N 张封面 + 1 次索引，单本补传也是 2 次写。
import { getKv } from './kv.js'
import { INDEX_KEY, getStore, nextUpdatedAt } from './coversStore.js'

export { INDEX_KEY }
export const MAX_IMAGE_BYTES = 48 * 1024
export const MAX_BULK_ITEMS = 40
export const MAX_DELETE_IDS = 200
export const MAX_BODY_BYTES = 1.5 * 1024 * 1024

/** 书 id：`bk_` + 64 位 FNV-1a 的 base36（由书名主干归一后计算，前端 / 脚本同一实现，见 tests/fixtures/book-id-cases.json） */
export const ID_RE = /^bk_[0-9a-z]{6,16}$/

export const coverKey = (id) => `cover:${id}`

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const int = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Math.round(Number(v)), 100000) : undefined)

const MAX_SUBJECTS = 8

/**
 * 元数据清洗：只留已知字段并限长（客户端不可信）。
 *   file     源文件名（含扩展名）：书架据此显示格式，也是「点开时去 WebDAV 找谁」的线索
 *   size     源文件字节数：点开时与下载到的文件比对，不一致说明书变了，需要重新提取
 *   subjects 分类标签（EPUB 的 dc:subject）；desc 简介；publisher / year / lang 出版信息
 */
export function cleanMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {}
  const out = { stem: str(m.stem, 240), title: str(m.title, 240) }
  const author = str(m.author, 120)
  if (author) out.author = author
  const pages = int(m.pages)
  if (pages) out.pages = pages
  const chapterCount = int(m.chapterCount)
  if (chapterCount) out.chapterCount = chapterCount
  const file = str(m.file, 240)
  if (file) out.file = file
  const size = Number(m.size)
  if (Number.isFinite(size) && size > 0) out.size = Math.min(Math.round(size), 2 ** 40)
  if (Array.isArray(m.subjects)) {
    const subjects = [...new Set(m.subjects.map((s) => str(s, 40)).filter(Boolean))].slice(0, MAX_SUBJECTS)
    if (subjects.length) out.subjects = subjects
  }
  const desc = str(m.desc, 400)
  if (desc) out.desc = desc
  const publisher = str(m.publisher, 80)
  if (publisher) out.publisher = publisher
  const year = Number(m.year)
  if (Number.isInteger(year) && year >= 1000 && year <= 2200) out.year = year
  const lang = str(m.lang, 12)
  if (lang) out.lang = lang
  return out
}

/**
 * 索引带 rev：每次写入换一个新值，GET 以它做 ETag，客户端重复进入书架只付一次 304 的代价。
 * 存储后端见 coversStore.js：绑定了 D1（FASTREADER_DB）就用 D1（逐书 CAS，不丢更新），否则回退 KV。
 */
export const readIndex = (env) => getStore(env).readIndex(env)
export const readIndexIfChanged = (env, etag) => getStore(env).readIndexIfChanged(env, etag)

/** base64 → 字节数（不解码，按长度推算），用来在写入前拒绝过大的图片 */
export function base64Bytes(b64) {
  const s = String(b64 || '').replace(/=+$/, '')
  return Math.floor((s.length * 3) / 4)
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 只解出前 n 个字节（文件头用，不解码整张图） */
export function base64Prefix(b64, n = 12) {
  const out = []
  let buf = 0
  let bits = 0
  for (const ch of String(b64 || '')) {
    const v = B64_CHARS.indexOf(ch)
    if (v < 0) break // '=' 或非法字符：到这就够判头了
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
      if (out.length >= n) break
    }
  }
  return out
}

/**
 * WebP 文件头：`RIFF` …4 字节长度… `WEBP`。
 * 客户端（canvas.toBlob('image/webp')）与预处理脚本（PIL `save(..., "WEBP")`）产出的都是真 webp；
 * 只按 base64 形状与体积校验的话，任意 ≤48KB 的字节都能塞进 `cover:` 键，再被当作 `image/webp` 发出去。
 */
export function isWebpBase64(b64) {
  const h = base64Prefix(b64, 12)
  return h.length >= 12 &&
    h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && // RIFF
    h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50 // WEBP
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * 写入一批条目：{id, meta, image?}（image 为 base64 webp；缺省 = 只更新元数据）。
 * 返回逐条结果；索引只写一次。已存在的封面不覆盖（除非 overwrite），脚本重跑不会白白烧写入额度。
 */
export async function putItems(env, items, { overwrite = false } = {}) {
  const kv = getKv(env)
  const store = getStore(env)
  // 只用来决定「封面已存在则不覆盖」；真正改索引时 commit 会重读最新的
  const known = await store.loadItems(env, items.map((it) => it?.id).filter((id) => typeof id === 'string' && ID_RE.test(id)))
  const results = []
  const changes = []
  for (const it of items) {
    const id = it?.id
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      results.push({ id: String(id), status: 'bad_id' })
      continue
    }
    const meta = cleanMeta(it.meta)
    const prev = known[id]
    let hasCover = !!prev?.cover
    let status = 'meta'
    if (typeof it.image === 'string' && it.image) {
      if (!B64_RE.test(it.image) || base64Bytes(it.image) > MAX_IMAGE_BYTES || !isWebpBase64(it.image)) {
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
    // 整条替换（书被换过）：新文件没有封面就不能留着旧书的封面
    if (overwrite && prev?.cover && !(typeof it.image === 'string' && it.image)) {
      await kv.delete(coverKey(id))
      hasCover = false
    }
    changes.push({ id, meta, hasCover, stored: status === 'stored' })
    results.push({ id, status })
  }
  // 同一个 id 可能在一批里出现多次：按顺序依次合并。step 可能因并发冲突被重放，所以只依赖 prev、不带副作用
  const byId = new Map()
  for (const c of changes) byId.set(c.id, [...(byId.get(c.id) ?? []), c])
  await store.commit(env, [...byId.keys()], (id, prev) => {
    let cur = prev
    let changed = false
    for (const { meta, hasCover, stored } of byId.get(id)) {
      // 默认只合并（补缺，不抹掉已有字段）；overwrite 是「这是另一本书了」，旧值（分类 / 简介 / 出版社…）不能残留
      const base = overwrite ? {} : (cur ?? {})
      // coverAt：封面真正被写入的时间。只有「新写 / 覆盖」才更新；元数据补传不动它，否则每次补元数据都会让各端缓存的封面失效
      const next = { ...base, ...meta, ...(hasCover ? { cover: 1 } : {}) }
      if (stored) next.coverAt = cur?.coverAt && cur.coverAt >= Date.now() ? cur.coverAt + 1 : Date.now()
      if (JSON.stringify(next) !== JSON.stringify(cur)) {
        cur = { ...next, updatedAt: nextUpdatedAt(cur) }
        changed = true
      }
    }
    return changed ? cur : undefined
  })
  return results
}

/**
 * 删除条目（封面 + 索引项），索引只写一次。只在用户确认「WebDAV 上已找不到这本书」后调用；
 * 不存在的 id 当作已删除，保证重复调用是幂等的。
 */
export async function deleteItems(env, ids) {
  const kv = getKv(env)
  const store = getStore(env)
  const known = await store.loadItems(env, ids.filter((id) => typeof id === 'string' && ID_RE.test(id)))
  const results = []
  const valid = []
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      results.push({ id: String(id), status: 'bad_id' })
      continue
    }
    if (known[id]?.cover) await kv.delete(coverKey(id))
    valid.push(id)
    results.push({ id, status: 'deleted' })
  }
  await store.commit(env, valid, (_id, prev) => (prev ? null : undefined))
  return results
}

export async function readCover(env, id) {
  return getKv(env).get(coverKey(id))
}
