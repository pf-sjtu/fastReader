/**
 * 书库索引的 D1 后端（真 SQLite 适配器）：KV 回退不变、首次从 KV 导入、逐书 CAS 不丢更新、304 只读 rev、冲突耗尽 → 409。
 * KV 后端的行为由 securityCovers*.test.ts 守着；这里只测 D1 路径与两者的接缝。
 */
import { describe, it, expect } from 'vitest'
import { onRequest as covers } from '../functions/api/covers/[[action]].js'
import { deleteItems, putItems, readIndex } from '../functions/_lib/covers.js'
import { createEnv } from './__mocks__/memoryKv'
import { createSqliteD1, type SqliteD1 } from './__mocks__/sqliteD1'

const A = 'bk_aaaaaa'
const B = 'bk_bbbbbb'
const WEBP = (() => {
  const u8 = new Uint8Array(40).fill(5)
  u8.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  u8.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  return Buffer.from(u8).toString('base64')
})()

const newEnv = () => {
  const db = createSqliteD1()
  return { db, env: createEnv({ FASTREADER_DB: db }) }
}
const item = (id: string, meta: Record<string, unknown> = {}, image?: string) => ({ id, meta: { stem: `s-${id}`, title: `T-${id}`, ...meta }, ...(image ? { image } : {}) })
const get = (env: unknown, init: RequestInit = {}) => covers({ request: new Request('https://app.example/api/covers', init), env } as never)
const rows = (db: SqliteD1) => db.__all('SELECT id, json, updated_at FROM covers_items ORDER BY id')

describe('D1 后端：基本读写', () => {
  it('写入落在 D1，KV 里不再有索引键；封面图仍在 KV', async () => {
    const { db, env } = newEnv()
    const r = await putItems(env, [item(A, { author: '甲' }, WEBP)])
    expect(r).toEqual([{ id: A, status: 'stored' }])
    expect(rows(db).map((x) => x.id)).toEqual([A])
    expect(env.FASTREADER_KV.__keys()).toEqual([`cover:${A}`]) // 没有 covers:index
    const idx = await readIndex(env)
    expect(idx.items[A]).toMatchObject({ title: `T-${A}`, author: '甲', cover: 1 })
  })

  it('已有封面不覆盖、元数据照常合并；无变化不重写', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A, {}, WEBP)])
    const first = rows(db)[0]
    expect((await putItems(env, [item(A, {}, WEBP)]))[0].status).toBe('exists')
    expect(rows(db)[0]).toEqual(first) // 完全没变：updated_at 不动
    await putItems(env, [item(A, { author: '补上' })])
    expect((await readIndex(env)).items[A]).toMatchObject({ author: '补上', cover: 1 })
  })

  it('同一批里同一个 id 出现两次：按顺序合并', async () => {
    const { env } = newEnv()
    await putItems(env, [item(A, { author: '先' }), item(A, { pages: 7 })])
    expect((await readIndex(env)).items[A]).toMatchObject({ author: '先', pages: 7 })
  })

  it('删除：行与封面键都没了；重复删除幂等', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A, {}, WEBP), item(B)])
    expect(await deleteItems(env, [A, 'nope'])).toEqual([{ id: A, status: 'deleted' }, { id: 'nope', status: 'bad_id' }])
    expect(rows(db).map((x) => x.id)).toEqual([B])
    expect(env.FASTREADER_KV.__keys()).toEqual([])
    expect((await deleteItems(env, [A]))[0].status).toBe('deleted') // 已不存在也算删除成功
  })
})

describe('D1 后端：ETag / 304', () => {
  it('rev 随写入变化；If-None-Match 命中回 304，且只读 rev 一行、不碰条目表', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A)])
    const r1 = await get(env)
    const etag = r1.headers.get('ETag')!
    expect(r1.status).toBe(200)
    db.__log.length = 0
    const r2 = await get(env, { headers: { 'If-None-Match': etag } })
    expect(r2.status).toBe(304)
    expect(db.__log.some((s) => /FROM covers_items/i.test(s))).toBe(false)
    await putItems(env, [item(B)])
    const r3 = await get(env, { headers: { 'If-None-Match': etag } })
    expect(r3.status).toBe(200) // rev 变了
    expect(r3.headers.get('ETag')).not.toBe(etag)
  })
})

describe('D1 后端：首次从 KV 导入', () => {
  const legacy = { rev: 42, items: { [A]: { stem: 'a', title: 'A', cover: 1, updatedAt: 111 }, [B]: { stem: 'b', title: 'B', updatedAt: 222 } } }

  it('没有 rev 行时把 KV 旧索引复制进 D1，rev 沿用，KV 里的旧索引原样保留', async () => {
    const { db, env } = newEnv()
    await env.FASTREADER_KV.put('covers:index', JSON.stringify(legacy))
    const idx = await readIndex(env)
    expect(idx.rev).toBe(42)
    expect(Object.keys(idx.items).sort()).toEqual([A, B])
    expect(rows(db)).toHaveLength(2)
    expect(JSON.parse((await env.FASTREADER_KV.get('covers:index'))!)).toEqual(legacy)
  })

  it('导入只发生一次：之后 KV 旧索引再变也不会回灌', async () => {
    const { env } = newEnv()
    await env.FASTREADER_KV.put('covers:index', JSON.stringify(legacy))
    await readIndex(env)
    await env.FASTREADER_KV.put('covers:index', JSON.stringify({ rev: 99, items: { bk_zzzzzz: { stem: 'z', title: 'Z' } } }))
    // 新的 isolate（新 env / 新 db 实例才会重新判断；同一 db 实例已就绪），这里用写入后再读验证不回灌
    await putItems(env, [item('bk_cccccc')])
    const idx = await readIndex(env)
    expect(Object.keys(idx.items).sort()).toEqual([A, B, 'bk_cccccc'])
  })

  it('KV 里没有旧索引（全新部署）→ 空库，rev 为 0', async () => {
    const { env } = newEnv()
    expect(await readIndex(env)).toEqual({ rev: 0, items: {} })
  })

  it('没有 KV 绑定也能用（只靠 D1）', async () => {
    const db = createSqliteD1()
    expect(await readIndex({ FASTREADER_DB: db })).toEqual({ rev: 0, items: {} })
  })
})

describe('D1 后端：并发写不丢更新', () => {
  it('两个并发 putItems 写不同的书：都在（KV 下这正是会丢的场景）', async () => {
    const { env } = newEnv()
    await Promise.all([putItems(env, [item(A, { author: '甲' })]), putItems(env, [item(B, { author: '乙' })])])
    const idx = await readIndex(env)
    expect(idx.items[A].author).toBe('甲')
    expect(idx.items[B].author).toBe('乙')
  })

  it('同一本书被另一个写入者抢先改了：CAS 失败后重读重算，两边的字段都保留', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A)])
    // 在 commit 读到旧行之后、写入之前，让「另一个写入者」改掉这一行（只在第一次发生）
    let injected = false
    const realPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      const st = realPrepare(sql)
      if (!injected && /^INSERT INTO covers_items/i.test(sql)) {
        injected = true
        const cur = JSON.parse(db.__all('SELECT json FROM covers_items WHERE id = ?', A)[0].json as string)
        db.__exec('UPDATE covers_items SET json = ?, updated_at = updated_at + 1000 WHERE id = ?', JSON.stringify({ ...cur, publisher: '别人写的' }), A)
      }
      return st
    }
    await putItems(env, [item(A, { author: '我写的' })])
    expect((await readIndex(env)).items[A]).toMatchObject({ author: '我写的', publisher: '别人写的' })
    expect(injected).toBe(true)
  })

  it('一直被抢（重试耗尽）→ 抛 index_conflict，接口回 409，库里不留半写状态', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A)])
    const before = rows(db)[0]
    const realPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      if (/^INSERT INTO covers_items/i.test(sql)) db.__exec('UPDATE covers_items SET updated_at = updated_at + 1000 WHERE id = ?', A)
      return realPrepare(sql)
    }
    await expect(putItems(env, [item(A, { author: '永远写不进去' })])).rejects.toMatchObject({ code: 'index_conflict' })
    expect(JSON.parse(rows(db)[0].json as string).author).toBeUndefined()
    expect(rows(db)[0].json).toBe(before.json)
    const res = await covers({ request: new Request(`https://app.example/api/covers/${A}`, { method: 'PUT', body: new Uint8Array(0), headers: { 'X-Book-Meta': encodeURIComponent('{"stem":"s","title":"T","author":"x"}') } }), env } as never)
    expect(res.status).toBe(409)
  })
})

describe('D1 后端：env 对象每个请求都换（isolate 内记忆失效）时的成本与正确性', () => {
  it('新的 db 句柄只多一次廉价的 rev 读：不再建表、不再导入 KV', async () => {
    const { db, env } = newEnv()
    await env.FASTREADER_KV.put('covers:index', JSON.stringify({ rev: 5, items: { [A]: { stem: 'a', title: 'A', updatedAt: 1 } } }))
    await readIndex(env) // 第一次：建表 + 导入
    const creates = () => db.__log.filter((s) => /CREATE TABLE/i.test(s)).length
    expect(creates()).toBe(2)
    await env.FASTREADER_KV.put('covers:index', JSON.stringify({ rev: 99, items: { [B]: { stem: 'b', title: 'B' } } }))

    // 同一个库、但每次都是新的绑定对象（WeakMap 命不中）
    const fresh = { ...env, FASTREADER_DB: Object.create(db) }
    await readIndex(fresh)
    await putItems(fresh, [item('bk_cccccc')])
    expect(creates()).toBe(2) // 没有再建表
    expect(Object.keys((await readIndex(fresh)).items).sort()).toEqual([A, 'bk_cccccc']) // 没有把 KV 里后来的 B 回灌
  })

  it('删除遇到并发修改：CAS 失败后重读再删，最终行没了', async () => {
    const { db, env } = newEnv()
    await putItems(env, [item(A)])
    let injected = false
    const realPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      if (!injected && /^DELETE FROM covers_items/i.test(sql)) {
        injected = true
        db.__exec('UPDATE covers_items SET updated_at = updated_at + 1000 WHERE id = ?', A) // 别人在读与删之间改了这一行
      }
      return realPrepare(sql)
    }
    await deleteItems(env, [A])
    expect(injected).toBe(true)
    expect(rows(db)).toHaveLength(0)
  })
})

describe('没有 D1 绑定时回退 KV', () => {
  it('行为与以前一致：索引在 covers:index 里', async () => {
    const env = createEnv()
    await putItems(env, [item(A, {}, WEBP)])
    expect(env.FASTREADER_KV.__keys().sort()).toEqual([`cover:${A}`, 'covers:index'])
    expect((await readIndex(env)).items[A]).toMatchObject({ cover: 1 })
  })
})
