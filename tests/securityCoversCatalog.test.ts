/**
 * 云端书目 metadata 的生命周期（服务端）：新字段清洗、索引版本 + ETag、元数据单独更新、
 * 源文件变了时覆盖封面、确认缺失后的删除（单个 / 批量 / 幂等）
 */
import { describe, it, expect } from 'vitest'
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
  it('每次写入 rev+1；If-None-Match 命中回 304，改动后不再命中', async () => {
    const env = createEnv()
    const first = await index(env)
    expect(((await first.json()) as Idx).rev).toBe(0)

    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(50), headers: { 'X-Book-Meta': enc({ stem: 'a', title: 'A' }) } })
    const r1 = await index(env)
    const etag = r1.headers.get('ETag')!
    expect(((await r1.json()) as Idx).rev).toBe(1)
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
    expect(idx.rev).toBe(before + 1)
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
