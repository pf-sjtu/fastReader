// @vitest-environment node
/**
 * 真实 webdav 库 + 本地 HTTP 服务（不 mock 库）：
 * 列目录不再被 runExclusive 串行；并发请求各自带各自的 X-WebDAV-Path（覆盖 client 上共享的旧头）。
 * 这是书库兜底遍历「6 路并行」真正生效的前提——此前并行在生产里被串行锁吃掉了，而用假 list 的单测发现不了。
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from 'webdav'
import { getDirectoryContents } from '@/services/webdav/browse'
import { listTree } from '@/services/library/listTree'
import type { DavContext } from '@/services/webdav/types'

const seen: { path: string; depth: string | undefined; at: number }[] = []
let inFlight = 0
let peak = 0
let server: http.Server
let baseUrl = ''

/** 路径 → 子项；目录 href 以 / 结尾 */
const TREE: Record<string, string[]> = {
  '/books': ['/books/a/', '/books/b/', '/books/c/', '/books/d/', '/books/top.epub'],
  '/books/a': ['/books/a/a1.epub'],
  '/books/b': ['/books/b/b1.pdf'],
  '/books/c': ['/books/c/c1.epub'],
  '/books/d': ['/books/d/d1.epub'],
}

function multistatus(path: string): string {
  const entry = (href: string) => {
    const isDir = href.endsWith('/')
    return `<d:response><d:href>/dav${href}</d:href><d:propstat><d:prop>${
      isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:getcontentlength>5</d:getcontentlength><d:resourcetype/>'
    }</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  }
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entry(path + '/')}${(TREE[path] ?? []).map(entry).join('')}</d:multistatus>`
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = decodeURIComponent(String(req.headers['x-webdav-path'] ?? ''))
    seen.push({ path, depth: req.headers['depth'] as string | undefined, at: Date.now() })
    inFlight++
    peak = Math.max(peak, inFlight)
    // 模拟每次往返 80ms（真实站点是 0.5–2s）
    setTimeout(() => {
      inFlight--
      // Depth: infinity 被拒（InfiniCLOUD 的行为）
      if (req.headers['depth'] === 'infinity') {
        res.writeHead(403)
        return res.end()
      }
      res.writeHead(207, { 'content-type': 'application/xml' })
      res.end(multistatus(path))
    }, 80)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dav`
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'http://test.local' } }
})
afterAll(() => {
  server.close()
  delete (globalThis as { window?: unknown }).window
})

function makeCtx(): DavContext {
  const client = createClient(baseUrl, { headers: { 'X-WebDAV-Path': 'STALE-SHARED-HEADER' } })
  return {
    client,
    config: { serverUrl: 'http://127.0.0.1/dav/', browsePath: '/books' },
    // 串行锁：若 getDirectoryContents 还在用它，peak 会恒为 1
    runExclusive: (() => {
      let chain: Promise<unknown> = Promise.resolve()
      return <T,>(fn: () => Promise<T>) => {
        const run = chain.then(fn, fn)
        chain = run.then(() => undefined, () => undefined)
        return run
      }
    })(),
    setDavHeader: () => {
      throw new Error('列目录不应再改共享头')
    },
  } as unknown as DavContext
}

describe('目录列表：真实 webdav 库，并发且各带各的路径', () => {
  it('四个目录同时列：各自命中自己的路径（不是共享头里的 STALE），且确实并发（peak>1）', async () => {
    seen.length = 0
    peak = 0
    const ctx = makeCtx()
    const t0 = Date.now()
    const results = await Promise.all(['/books/a', '/books/b', '/books/c', '/books/d'].map((d) => getDirectoryContents(ctx, d, false)))
    const elapsed = Date.now() - t0
    expect(results.every((r) => r.success)).toBe(true)
    expect(seen.map((s) => s.path).sort()).toEqual(['/books/a', '/books/b', '/books/c', '/books/d'])
    expect(seen.some((s) => s.path.includes('STALE'))).toBe(false)
    expect(peak).toBeGreaterThan(1)
    expect(elapsed).toBeLessThan(80 * 4) // 串行至少 320ms
    const names = results.map((r) => (r.success ? r.data!.map((f) => f.basename).filter((n) => n.endsWith('.epub') || n.endsWith('.pdf')) : []))
    expect(names).toEqual([['a1.epub'], ['b1.pdf'], ['c1.epub'], ['d1.epub']])
  })

  it('接上 listTree：深度被 403 → 逐层并行遍历，取全所有书，请求路径正确', async () => {
    seen.length = 0
    peak = 0
    const ctx = makeCtx()
    const files = await listTree((dir, deep) => getDirectoryContents(ctx, dir, deep), '/books')
    expect(files.map((f) => f.basename).sort()).toEqual(['a1.epub', 'b1.pdf', 'c1.epub', 'd1.epub', 'top.epub'])
    expect(peak).toBeGreaterThan(1)
    // 1 次 infinity + 根目录 1 次 + 4 个子目录各 1 次
    expect(seen).toHaveLength(6)
    expect(seen.filter((s) => s.depth === 'infinity')).toHaveLength(1)
  })
})
