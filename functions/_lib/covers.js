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

export const INDEX_KEY = 'covers:index'
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

/** 索引带 rev：每次写入 +1，GET 以它做 ETag，客户端重复进入书架只付一次 304 的代价 */
export async function readIndex(env) {
  const raw = await getKv(env).get(INDEX_KEY)
  if (!raw) return { rev: 0, items: {} }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed.items === 'object' && parsed.items
      ? { rev: Number(parsed.rev) || 0, items: parsed.items }
      : { rev: 0, items: {} }
  } catch {
    return { rev: 0, items: {} }
  }
}

/**
 * 新版本号：单调且几乎不会撞车。两个并发写入若各自 +1 会得到同一个 rev（ETag 相同而内容不同），
 * 已拿到第一版的客户端就会对第二版一直收到 304；带时间戳与随机尾数后，撞车的概率可忽略（< 2^53）。
 */
const nextRev = (prev) => Math.max((prev || 0) + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** KV 对同一个键限 1 次写/秒（超出会抛 429）：补全时连续上传很容易撞上，等一下重试一次 */
async function putIndex(kv, index) {
  const body = JSON.stringify({ ...index, rev: nextRev(index.rev) })
  try {
    await kv.put(INDEX_KEY, body)
  } catch {
    await sleep(1100)
    await kv.put(INDEX_KEY, body)
  }
}

/**
 * 读-改-写索引。KV 没有 compare-and-set，丢更新无法根治（要彻底串行化得上 Durable Object / D1）；
 * 这里把「读」推迟到真正写入前一刻，窗口从「整批封面写完」缩到几毫秒，再配合上面的唯一 rev 与重试。
 * mutate 在最新的索引上就地修改，返回是否有变化；没有变化就不写（保护免费额度）。
 */
async function commitIndex(env, mutate) {
  const kv = getKv(env)
  const index = await readIndex(env)
  if (!mutate(index)) return false
  await putIndex(kv, index)
  return true
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
  const index = await readIndex(env) // 只用来决定「封面已存在则不覆盖」；真正改索引时会重读最新的
  const results = []
  const changes = []
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
    // 整条替换（书被换过）：新文件没有封面就不能留着旧书的封面
    if (overwrite && prev?.cover && !(typeof it.image === 'string' && it.image)) {
      await kv.delete(coverKey(id))
      hasCover = false
    }
    changes.push({ id, meta, hasCover, stored: status === 'stored' })
    results.push({ id, status })
  }
  await commitIndex(env, (cur) => {
    let dirty = false
    for (const { id, meta, hasCover, stored } of changes) {
      const prev = cur.items[id]
      // 默认只合并（补缺，不抹掉已有字段）；overwrite 是「这是另一本书了」，旧值（分类 / 简介 / 出版社…）不能残留
      const base = overwrite ? {} : (prev ?? {})
      // coverAt：封面真正被写入的时间。只有「新写 / 覆盖」才更新；元数据补传不动它，否则每次补元数据都会让各端缓存的封面失效
      const next = { ...base, ...meta, ...(hasCover ? { cover: 1 } : {}) }
      if (stored) next.coverAt = prev?.coverAt && prev.coverAt >= Date.now() ? prev.coverAt + 1 : Date.now()
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        cur.items[id] = { ...next, updatedAt: Date.now() }
        dirty = true
      }
    }
    return dirty
  })
  return results
}

/**
 * 删除条目（封面 + 索引项），索引只写一次。只在用户确认「WebDAV 上已找不到这本书」后调用；
 * 不存在的 id 当作已删除，保证重复调用是幂等的。
 */
export async function deleteItems(env, ids) {
  const kv = getKv(env)
  const index = await readIndex(env)
  const results = []
  const valid = []
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      results.push({ id: String(id), status: 'bad_id' })
      continue
    }
    if (index.items[id]?.cover) await kv.delete(coverKey(id))
    valid.push(id)
    results.push({ id, status: 'deleted' })
  }
  await commitIndex(env, (cur) => {
    let dirty = false
    for (const id of valid) {
      if (id in cur.items) {
        delete cur.items[id]
        dirty = true
      }
    }
    return dirty
  })
  return results
}

export async function readCover(env, id) {
  return getKv(env).get(coverKey(id))
}
