// 书库索引的存储后端：D1（绑定了 FASTREADER_DB 时）或 KV（回退）。业务规则在 covers.js，这里只管「怎么存」。
//
// 为什么索引要有两种后端：
//   KV：整个索引是一个 JSON，读-改-写没有 compare-and-set，两个写入者同时改会丢更新（缓解见 kvStore）。
//   D1：每本书一行，写入带 CAS（`updated_at` 与读到的一致才写，否则重读重试），丢更新只可能发生在「同一本书同一毫秒」且会被重试挡住。
// 封面图（`cover:<id>`）与共享状态（`state:*`）不在这里，仍是 KV。
//
// 统一接口（env 里没有 D1 就用 KV）：
//   readIndex(env)                  → {rev, items}
//   readIndexIfChanged(env, etag)   → {notModified:true, rev} | {index}   D1 下 304 只读 1 行
//   loadItems(env, ids)             → {[id]: item}                          只含存在的
//   commit(env, ids, step)          → boolean（是否有写入）
//     step(id, prev) → 新条目（写入）| null（删除）| undefined（无变化）；条目的 updatedAt 由 step 负责（用 nextUpdatedAt）
import { getKv } from './kv.js'

export const INDEX_KEY = 'covers:index'

const EMPTY = () => ({ rev: 0, items: {} })

/**
 * 新版本号：单调且几乎不会撞车。两个并发写入若各自 +1 会得到同一个 rev（ETag 相同而内容不同），
 * 已拿到第一版的客户端就会对第二版一直收到 304；带时间戳与随机尾数后，撞车的概率可忽略（< 2^53）。
 */
export const nextRev = (prev) => Math.max((prev || 0) + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000))

/** 条目的 updatedAt：单调递增，避免同一毫秒内两次写入拿到同一个值（CAS 靠它判断「读到之后有没有人改过」） */
export const nextUpdatedAt = (prev) => Math.max(Date.now(), (Number(prev?.updatedAt) || 0) + 1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- KV

async function kvReadIndex(env) {
  const raw = await getKv(env).get(INDEX_KEY)
  if (!raw) return EMPTY()
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed.items === 'object' && parsed.items
      ? { rev: Number(parsed.rev) || 0, items: parsed.items }
      : EMPTY()
  } catch {
    return EMPTY()
  }
}

/** KV 对同一个键限 1 次写/秒（超出会抛 429）：补全时连续上传很容易撞上，等一下重试一次 */
async function kvPutIndex(kv, index) {
  const body = JSON.stringify({ ...index, rev: nextRev(index.rev) })
  try {
    await kv.put(INDEX_KEY, body)
  } catch {
    await sleep(1100)
    await kv.put(INDEX_KEY, body)
  }
}

const kvStore = {
  readIndex: kvReadIndex,
  async readIndexIfChanged(env, etag) {
    const index = await kvReadIndex(env)
    return etag && etag === `"r${index.rev}"` ? { notModified: true, rev: index.rev } : { index }
  },
  async loadItems(env, ids) {
    const { items } = await kvReadIndex(env)
    return Object.fromEntries(ids.filter((id) => items[id]).map((id) => [id, items[id]]))
  },
  /** KV 没有 compare-and-set：把「读」推迟到真正写入前一刻，窗口缩到几毫秒，再配合唯一 rev 与重试（无法根治） */
  async commit(env, ids, step) {
    const kv = getKv(env)
    const index = await kvReadIndex(env)
    let dirty = false
    for (const id of ids) {
      const next = step(id, index.items[id])
      if (next === undefined) continue
      if (next === null) delete index.items[id]
      else index.items[id] = next
      dirty = true
    }
    if (!dirty) return false // 没有变化就不写（保护免费额度）
    await kvPutIndex(kv, index)
    return true
  },
}

// ---------------------------------------------------------------- D1

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS covers_items (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS covers_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
]
const IMPORT_CHUNK = 80
const MAX_ATTEMPTS = 4

/** 每个 D1 实例只建表 / 导入一次（isolate 内记忆；跨 isolate 靠 IF NOT EXISTS 与 INSERT OR IGNORE 幂等） */
const ready = new WeakMap()

/**
 * 建表；首次使用（没有 rev 行）时把 KV 里已有的索引复制进来（只读 KV、不删不改，KV 里的旧索引留作回退）。
 * rev 行最后写：导入中途失败下次会整体重来，INSERT OR IGNORE 保证重复导入无副作用。
 */
async function ensureReady(db, env) {
  let p = ready.get(db)
  if (!p) {
    p = (async () => {
      // 先做廉价检查：已初始化（绝大多数请求）只多这一次读，不再发建表批处理——即使每个请求拿到的是新的 env.FASTREADER_DB 对象也只多这一次
      try {
        if (await db.prepare("SELECT v FROM covers_meta WHERE k = 'rev'").first()) return
      } catch {
        // 表还没建：往下走完整初始化
      }
      await db.batch(SCHEMA.map((s) => db.prepare(s)))
      const has = await db.prepare("SELECT v FROM covers_meta WHERE k = 'rev'").first()
      if (has) return
      const legacy = env?.FASTREADER_KV ? await kvReadIndex(env) : EMPTY()
      const entries = Object.entries(legacy.items)
      for (let i = 0; i < entries.length; i += IMPORT_CHUNK) {
        await db.batch(
          entries.slice(i, i + IMPORT_CHUNK).map(([id, it]) =>
            db.prepare('INSERT OR IGNORE INTO covers_items (id, json, updated_at) VALUES (?, ?, ?)').bind(id, JSON.stringify(it), Number(it.updatedAt) || 0)
          )
        )
      }
      await db.prepare("INSERT OR IGNORE INTO covers_meta (k, v) VALUES ('rev', ?)").bind(String(legacy.rev || 0)).run()
    })()
    ready.set(db, p)
    p.catch(() => ready.delete(db)) // 失败不缓存，下次请求重试
  }
  return p
}

const placeholders = (n) => Array.from({ length: n }, () => '?').join(',')

async function d1Rows(db, ids) {
  const out = {}
  // D1 单条语句最多 100 个绑定参数
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const { results } = await db.prepare(`SELECT id, json, updated_at FROM covers_items WHERE id IN (${placeholders(chunk.length)})`).bind(...chunk).all()
    for (const r of results ?? []) out[r.id] = r
  }
  return out
}

function d1Of(env) {
  const db = env?.FASTREADER_DB
  return db && typeof db.prepare === 'function' && typeof db.batch === 'function' ? db : null
}

const parseRow = (r) => {
  try {
    return JSON.parse(r.json)
  } catch {
    return null
  }
}

function d1Store(db) {
  const readRev = async () => Number((await db.prepare("SELECT v FROM covers_meta WHERE k = 'rev'").first())?.v) || 0
  return {
    async readIndex(env) {
      await ensureReady(db, env)
      // batch 是一个事务：rev 与条目取自同一个快照，ETag 不会对不上内容
      const [revRes, itemsRes] = await db.batch([
        db.prepare("SELECT v FROM covers_meta WHERE k = 'rev'"),
        db.prepare('SELECT id, json FROM covers_items'),
      ])
      const items = {}
      for (const r of itemsRes.results ?? []) {
        const it = parseRow(r)
        if (it) items[r.id] = it
      }
      return { rev: Number(revRes.results?.[0]?.v) || 0, items }
    },
    async readIndexIfChanged(env, etag) {
      await ensureReady(db, env)
      const rev = await readRev()
      if (etag && etag === `"r${rev}"`) return { notModified: true, rev }
      return { index: await this.readIndex(env) }
    },
    async loadItems(env, ids) {
      await ensureReady(db, env)
      const rows = await d1Rows(db, ids)
      const out = {}
      for (const [id, r] of Object.entries(rows)) {
        const it = parseRow(r)
        if (it) out[id] = it
      }
      return out
    },
    /** 逐条 CAS：`updated_at` 仍是读到的值才写；被别人抢先改过的条目（changes = 0）重读后重新计算，最多 MAX_ATTEMPTS 轮 */
    async commit(env, ids, step) {
      await ensureReady(db, env)
      let pending = [...new Set(ids)]
      let wrote = false
      for (let attempt = 0; pending.length && attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt) await sleep(20 * attempt)
        const rows = await d1Rows(db, pending)
        const ops = []
        for (const id of pending) {
          const row = rows[id]
          const prev = row ? parseRow(row) : undefined
          const next = step(id, prev ?? undefined)
          if (next === undefined) continue
          if (next === null) {
            if (row) ops.push({ id, stmt: db.prepare('DELETE FROM covers_items WHERE id = ? AND updated_at = ?').bind(id, row.updated_at) })
          } else {
            ops.push({
              id,
              stmt: db
                .prepare(
                  'INSERT INTO covers_items (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at WHERE covers_items.updated_at IS ?'
                )
                .bind(id, JSON.stringify(next), Number(next.updatedAt) || 0, row ? row.updated_at : null),
            })
          }
        }
        if (!ops.length) return wrote
        const rev = nextRev(await readRev())
        const results = await db.batch([...ops.map((o) => o.stmt), db.prepare("INSERT INTO covers_meta (k, v) VALUES ('rev', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(rev))])
        const lost = ops.filter((_, i) => !(results[i]?.meta?.changes > 0)).map((o) => o.id)
        wrote = wrote || lost.length < ops.length
        pending = lost
      }
      if (pending.length) {
        const error = new Error(`索引写入冲突：${pending.length} 本书在 ${MAX_ATTEMPTS} 轮重试后仍被并发修改`)
        error.code = 'index_conflict'
        throw error
      }
      return wrote
    },
  }
}

export const getStore = (env) => {
  const db = d1Of(env)
  return db ? d1Store(db) : kvStore
}
