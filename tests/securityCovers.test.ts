/**
 * 封面 / 元数据云存储（Functions + KV）：鉴权、读写、批量、限额、不覆盖、同源校验
 */
import { describe, it, expect } from 'vitest'
import { onRequest as covers } from '../functions/api/covers/[[action]].js'
import { onRequest as middleware } from '../functions/_middleware.js'
import { SESSION_COOKIE, createSessionToken } from '../functions/_lib/session.js'
import { createEnv } from './__mocks__/memoryKv'

const ID = 'bk_19872exvmifq5'
const ID2 = 'bk_zzzzzz'

function bytes(n: number, fill = 7) {
  return new Uint8Array(n).fill(fill)
}
const b64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64')

async function call(env: unknown, path: string, init: RequestInit & { cookie?: string } = {}, handler: (c: never) => Promise<Response> = covers as never) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(init.cookie)}`)
  const request = new Request(`https://app.example${path}`, { ...init, headers })
  return handler({ request, env, next: () => covers({ request, env } as never) } as never)
}

describe('/api/covers 鉴权', () => {
  it('未登录经中间件 → 401；已登录放行', async () => {
    const env = createEnv()
    const anon = await call(env, '/api/covers', {}, middleware as never)
    expect(anon.status).toBe(401)
    const cookie = await createSessionToken(env)
    const ok = await call(env, '/api/covers', { cookie }, middleware as never)
    expect(ok.status).toBe(200)
  })
})

describe('/api/covers 读写', () => {
  it('PUT 一张封面 → 索引带元数据 → GET 图片字节一致且可长缓存', async () => {
    const env = createEnv()
    const img = bytes(300, 9)
    const meta = encodeURIComponent(JSON.stringify({ stem: '书名 - 作者', title: '书名', author: '作者', pages: 12, chapterCount: 5, junk: 'x' }))
    const put = await call(env, `/api/covers/${ID}`, { method: 'PUT', body: img, headers: { 'X-Book-Meta': meta } })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ id: ID, status: 'stored' })

    const idx = (await (await call(env, '/api/covers')).json()) as { items: Record<string, Record<string, unknown>> }
    expect(idx.items[ID]).toEqual({ stem: '书名 - 作者', title: '书名', author: '作者', pages: 12, chapterCount: 5, cover: 1, updatedAt: expect.any(Number) }) // junk 被丢弃

    const get = await call(env, `/api/covers/${ID}`)
    expect(get.headers.get('Content-Type')).toBe('image/webp')
    expect(get.headers.get('Cache-Control')).toContain('immutable')
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(img)
    expect((await call(env, `/api/covers/${ID2}`)).status).toBe(404)
  })

  it('已有封面不覆盖（脚本重跑不白烧 KV 写入额度）；元数据仍可补', async () => {
    const env = createEnv()
    await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(100, 1), headers: { 'X-Book-Meta': encodeURIComponent('{"stem":"a","title":"A"}') } })
    const again = await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(100, 2), headers: { 'X-Book-Meta': encodeURIComponent('{"stem":"a","title":"A","author":"补上"}') } })
    expect((await again.json()).status).toBe('exists')
    const img = new Uint8Array(await (await call(env, `/api/covers/${ID}`)).arrayBuffer())
    expect(img[0]).toBe(1)
    const idx = (await (await call(env, '/api/covers')).json()) as { items: Record<string, { author?: string }> }
    expect(idx.items[ID].author).toBe('补上')
  })

  it('批量：一次请求写多本，索引只写一次；坏 id / 坏图片逐条报告，不影响其他条', async () => {
    const env = createEnv()
    const kv = (env as { FASTREADER_KV: { put: (k: string, v: string) => Promise<void> } }).FASTREADER_KV
    const writes: string[] = []
    const orig = kv.put.bind(kv)
    kv.put = async (k, v) => (writes.push(k), orig(k, v))
    const res = await call(env, '/api/covers/bulk', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { id: ID, meta: { stem: 'a', title: 'A' }, image: b64(bytes(50)) },
          { id: ID2, meta: { stem: 'b', title: 'B' } }, // 无封面：只更新元数据
          { id: 'evil/../x', meta: {}, image: b64(bytes(5)) },
          { id: 'bk_aaaaaaa', meta: {}, image: b64(bytes(60 * 1024)) }, // 超限
          { id: 'bk_bbbbbbb', meta: {}, image: '***not-base64***' },
        ],
      }),
    })
    const { results } = (await res.json()) as { results: { id: string; status: string }[] }
    expect(results.map((r) => r.status)).toEqual(['stored', 'meta', 'bad_id', 'bad_image', 'bad_image'])
    expect(writes.filter((k) => k === 'covers:index')).toHaveLength(1)
    expect(writes.filter((k) => k.startsWith('cover:'))).toEqual([`cover:${ID}`])
    const idx = (await (await call(env, '/api/covers')).json()) as { items: Record<string, { cover?: number }> }
    expect(idx.items[ID].cover).toBe(1)
    expect(idx.items[ID2].cover).toBeUndefined()
  })

  it('限额与校验：空 / 超大图片、坏元数据、坏 JSON、条数超限、跨站写入', async () => {
    const env = createEnv()
    expect((await call(env, `/api/covers/${ID}`, { method: 'PUT', body: new Uint8Array(0) })).status).toBe(413)
    expect((await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(49 * 1024) })).status).toBe(413)
    expect((await call(env, `/api/covers/${ID}`, { method: 'PUT', body: bytes(10), headers: { 'X-Book-Meta': '%E0%A4%A' } })).status).toBe(400)
    expect((await call(env, '/api/covers/bulk', { method: 'POST', body: '{坏' })).status).toBe(400)
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `bk_${String(i).padStart(7, 'a')}`, meta: {} }))
    expect((await call(env, '/api/covers/bulk', { method: 'POST', body: JSON.stringify({ items: many }) })).status).toBe(400)
    const cross = await call(env, '/api/covers/bulk', { method: 'POST', body: JSON.stringify({ items: [{ id: ID, meta: {} }] }), headers: { Origin: 'https://evil.example' } })
    expect(cross.status).toBe(403)
    expect((await call(env, '/api/covers/nope')).status).toBe(404)
  })

  it('没有 KV 绑定 → 503，不抛', async () => {
    const res = await call({}, '/api/covers')
    expect(res.status).toBe(503)
  })
})
