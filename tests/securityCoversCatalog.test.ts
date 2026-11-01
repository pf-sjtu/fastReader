/**
 * 云端书目 metadata 的生命周期（服务端）：新字段清洗、索引版本 + ETag、元数据单独更新、
 * 源文件变了时覆盖封面、确认缺失后的删除（单个 / 批量 / 幂等）
 */
import { describe, it, expect, vi } from 'vitest'
import { onRequest as covers } from '../functions/api/covers/[[action]].js'
import { cleanMeta } from '../functions/_lib/covers.js'
import { createEnv } from './__mocks__/memoryKv'

const ID = 'bk_19872exvmifq5'
const ID2 = 'bk_zzzzzz'
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill)
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))

async function call(env: unknown, path: string, init: RequestInit = {}) {
  return covers({ request: new Request(`https://app.example${path}`, init), env } as never)
}
type Idx = { rev: number; items: Record<string, Record<string, unknown>> }
const index = async (env: unknown, headers?: HeadersInit) => call(env, '/api/covers', { headers })

describe('cleanMeta：新字段', () => {
  it('保留 file/size/subjects/desc/publisher/year/lang，限长去重，丢弃非法值', () => {
    const m: Record<string, unknown> = cleanMeta({
      stem: 's',
      title: 't',
      file: ' a.epub ',
      size: 12345.6,
      subjects: ['Business', 'Business', ' History ', '', 5, 'x'.repeat(100)],
      desc: 'd'.repeat(900),
      publisher: '出版社',
      year: 2020,
      lang: 'zh-CN',
    })
    expect(m).toMatchObject({ file: 'a.epub', size: 12346, publisher: '出版社', year: 2020, lang: 'zh-CN' })
    expect(m.subjects).toEqual(['Business', 'History', 'x'.repeat(40)]) // 去重、去空、非字符串丢弃、单项限 40
    expect((m.desc as string).length).toBe(400)
    const bad = cleanMeta({ stem: 's', title: 't', year: 99, size: -1, subjects: 'Business', file: '' })
    expect(bad).toEqual({ stem: 's', title: 't' })
  })
  it('subjects 最多 8 个', () => {
    const m: Record<string, unknown[]> = cleanMeta({ subjects: Array.from({ length: 20 }, (_, i) => `s${i}`) }) as never
    expect(m.subjects).toHaveLength(8)
  })
})

describe('索引版本与 ETag', () => {
  it('每次改动 rev 都变且单调增；If-None-Match 命中回 304，改动后不再命中', async () => {
    const env = createEnv()
    const first = await index(env)
    expect(((await first.json()) as Idx).rev).toBe(0)

    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(50), headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A' }) } })
    const r1 = await index(env)
    const etag = r1.headers.get('ETag')!
    const rev1 = ((await r1.json()) as Idx).rev
    expect(rev1).toBeGreaterThan(0)
    expect(r1.headers.get('Cache-Control')).toContain('no-cache')

    const r304 = await index(env, { 'If-None-Match': etag })
    expect(r304.status).toBe(304)

    await call(env, `/api/covers/${ID2}`, { method: 'PUT', body: bytes(50), headers: { 'X-Book-Meta': enc({ stem: 'b', title: 'B' }) } })
    expect((await index(env, { 'If-None-Match': etag })).status).toBe(200)
  })

  it('内容没变的重复写入不 bump rev（不白烧写入额度）', async () => {
    const env = createEnv()
    const put = () => call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(50), headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A', file: 'a.epub' }) } })
    await put()
    const rev1 = ((await (await index(env)).json()) as Idx).rev
    // 第二次：封面已存在、元数据相同 → 没有真实变化，不写索引（updatedAt 只在变化时更新）
    await put()
    expect(((await (await index(env)).json()) as Idx).rev).toBe(rev1)
  })
})

describe('元数据单独更新与 replace', () => {
  it('空 body + X-Book-Meta：只补元数据，不动封面', async () => {
    const env = createEnv()
    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(80, 1), headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A' }) } })
    const r = await call(env, `/api/covers/${ID}`, { method: 'PUT', headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A', subjects: ['Business'], year: 2020 }) } })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { status: string }).status).toBe('meta')
    const it = ((await (await index(env)).json()) as Idx).items[ID]
    expect(it).toMatchObject({ subjects: ['Business'], year: 2020, cover: 1 })
    expect(typeof it.updatedAt).toBe('number')
    const img = new Uint8Array(await (await call(env, `/api/covers/${ID}`)).arrayBuffer())
    expect(img[0]).toBe(1)
  })

  it('空 body 且没有元数据 → 413（和以前一致）', async () => {
    expect((await call(createEnv(), `/api/covers/${ID}`, { method: 'PUT' })).status).toBe(413)
  })

  it('?replace=1 覆盖已有封面；不带则保留旧封面', async () => {
    const env = createEnv()
    const meta = { 'X-Book-Meta': enc({ stem: 'a', title: 'A' }) }
    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(80, 1), headers: meta })
    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(80, 2), headers: meta })
    expect(new Uint8Array(await (await call(env, `/api/covers/${ID}`)).arrayBuffer())[0]).toBe(1)
    const r = await call(env, `/api/covers/${ID}?replace=1`, { method: 'PUT', body: bytes(80, 3), headers: meta })
    expect(((await r.json()) as { status: string }).status).toBe('stored')
    expect(new Uint8Array(await (await call(env, `/api/covers/${ID}`)).arrayBuffer())[0]).toBe(3)
  })
})

describe('书被换过（replace）：整条替换，不残留旧书的资料', () => {
  const put = (env: unknown, q: string, meta: object, body?: Uint8Array) =>
    call(env, `/api/covers/${ID}${q}`, { method: 'PUT', body, headers: { 'X-Book-Meta': enc(meta) } })

  it('replace 时旧的分类 / 简介 / 出版社不再合并进来；默认（不带 replace）仍是只补缺', async () => {
    const env = createEnv()
    await put(env, '', { stem: 'a', title: 'A', subjects: ['History'], desc: '旧简介', publisher: '旧社' }, bytes(60, 1))
    await put(env, '', { stem: 'a', title: 'A', year: 2020 }) // 合并：旧字段保留
    expect(((await (await index(env)).json()) as Idx).items[ID]).toMatchObject({ subjects: ['History'], desc: '旧简介', year: 2020 })
    await put(env, '?replace=1', { stem: 'a', title: 'A（新版）' }, bytes(60, 9))
    const it = ((await (await index(env)).json()) as Idx).items[ID]
    expect(it).toMatchObject({ title: 'A（新版）', cover: 1 })
    expect(it).not.toHaveProperty('subjects')
    expect(it).not.toHaveProperty('desc')
    expect(it).not.toHaveProperty('publisher')
  })

  it('replace 且新文件没有封面：旧封面一并删掉（不能是 A 的封面配 B 的资料）', async () => {
    const env = createEnv()
    await put(env, '', { stem: 'a', title: 'A' }, bytes(60, 1))
    await put(env, '?replace=1', { stem: 'a', title: 'A2' })
    expect(((await (await index(env)).json()) as Idx).items[ID]).not.toHaveProperty('cover')
    expect((await call(env, `/api/covers/${ID}`)).status).toBe(404)
  })
})

describe('coverAt：封面真正写入的时间', () => {
  const put = (env: unknown, q: string, meta: object, body?: Uint8Array) =>
    call(env, `/api/covers/${ID}${q}`, { method: 'PUT', body, headers: { 'X-Book-Meta': enc(meta) } })
  const item = async (env: unknown) => ((await (await index(env)).json()) as Idx).items[ID]

  it('写入封面时记录；只补元数据不改它（否则每次补元数据都让各端缓存的封面失效）；replace 换封面则更新', async () => {
    const env = createEnv()
    await put(env, '', { stem: 'a', title: 'A' }, bytes(60, 1))
    const first = (await item(env)).coverAt as number
    expect(first).toBeGreaterThan(0)
    await put(env, '', { stem: 'a', title: 'A', subjects: ['History'] }) // 元数据补传
    expect((await item(env)).coverAt).toBe(first)
    await put(env, '', { stem: 'a', title: 'A' }, bytes(60, 2)) // 封面已存在且不 replace：不覆盖
    expect((await item(env)).coverAt).toBe(first)
    await put(env, '?replace=1', { stem: 'a', title: 'A' }, bytes(60, 3))
    expect((await item(env)).coverAt as number).toBeGreaterThan(first)
  })

  it('replace 且新文件没有封面：封面与 coverAt 一起去掉', async () => {
    const env = createEnv()
    await put(env, '', { stem: 'a', title: 'A' }, bytes(60, 1))
    await put(env, '?replace=1', { stem: 'a', title: 'A2' })
    expect(await item(env)).not.toHaveProperty('coverAt')
  })
})

describe('索引写入：限流重试', () => {
  it('KV 对同一键限 1 次写/秒：索引写入第一次失败会等待后重试一次，而不是整体 500', async () => {
    vi.useFakeTimers()
    try {
      const env = createEnv()
      const kv = (env as { FASTREADER_KV: { put: (k: string, v: string) => Promise<void> } }).FASTREADER_KV
      const orig = kv.put.bind(kv)
      let failed = false
      kv.put = async (k, v) => {
        if (k === 'covers:index' && !failed) {
          failed = true
          throw new Error('KV PUT failed: 429 Too Many Requests')
        }
        return orig(k, v)
      }
      const p = call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(50), headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A' }) } })
      await vi.advanceTimersByTimeAsync(1200)
      expect((await p).status).toBe(200)
      expect(failed).toBe(true)
      expect(((await (await index(env)).json()) as Idx).items[ID]).toMatchObject({ title: 'A', cover: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('删除（用户确认 WebDAV 上已找不到之后）', () => {
  async function seeded() {
    const env = createEnv()
    for (const id of [ID, ID2]) await call(env, `/api/covers/${id}`, { method: 'PUT', body: bytes(40), headers: { 'X-Book-Meta': enc({ stem: id, title: id }) } })
    return env
  }

  it('DELETE /:id 删封面与索引项，另一本不受影响，rev 增加', async () => {
    const env = await seeded()
    const before = ((await (await index(env)).json()) as Idx).rev
    const r = await call(env, `/api/covers/${ID}`, { method: 'DELETE' })
    expect(((await r.json()) as { status: string }).status).toBe('deleted')
    const idx = (await (await index(env)).json()) as Idx
    expect(Object.keys(idx.items)).toEqual([ID2])
    expect(idx.rev).toBeGreaterThan(before)
    expect((await call(env, `/api/covers/${ID}`)).status).toBe(404)
    expect((await call(env, `/api/covers/${ID2}`)).status).toBe(200)
  })

  it('幂等：重复删除 / 删不存在的 id 不报错也不 bump rev', async () => {
    const env = await seeded()
    await call(env, `/api/covers/${ID}`, { method: 'DELETE' })
    const rev = ((await (await index(env)).json()) as Idx).rev
    const again = await call(env, `/api/covers/${ID}`, { method: 'DELETE' })
    expect(again.status).toBe(200)
    expect(((await (await index(env)).json()) as Idx).rev).toBe(rev)
  })

  it('POST /delete 批量：索引只写一次；坏 id 逐条报告；超限 / 空列表 400', async () => {
    const env = await seeded()
    const kv = (env as { FASTREADER_KV: { put: (k: string, v: string) => Promise<void> } }).FASTREADER_KV
    const writes: string[] = []
    const orig = kv.put.bind(kv)
    kv.put = async (k, v) => (writes.push(k), orig(k, v))
    const r = await call(env, '/api/covers/delete', { method: 'POST', body: JSON.stringify({ ids: [ID, ID2, 'evil/../x'] }) })
    const { results } = (await r.json()) as { results: { status: string }[] }
    expect(results.map((x) => x.status)).toEqual(['deleted', 'deleted', 'bad_id'])
    expect(writes.filter((k) => k === 'covers:index')).toHaveLength(1)
    expect(Object.keys(((await (await index(env)).json()) as Idx).items)).toEqual([])
    expect((await call(env, '/api/covers/delete', { method: 'POST', body: JSON.stringify({ ids: [] }) })).status).toBe(400)
    const many = Array.from({ length: 201 }, (_, i) => `bk_${String(i).padStart(7, 'a')}`)
    expect((await call(env, '/api/covers/delete', { method: 'POST', body: JSON.stringify({ ids: many }) })).status).toBe(400)
  })

  it('跨站删除被拒（需同源）', async () => {
    const env = await seeded()
    const r = await call(env, `/api/covers/${ID}`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } })
    expect(r.status).toBe(403)
    expect(Object.keys(((await (await index(env)).json()) as Idx).items)).toHaveLength(2)
  })
})
