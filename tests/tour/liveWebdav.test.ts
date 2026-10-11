// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:38123" }
/**
 * 真实 WebDAV 联调（长期保留，默认跳过）：前端 WebDAVService → 真实代理代码 → 真实 WebDAV 服务器。
 *
 * 运行：E2E_CONFIG=<Web 端导出的配置 yaml> pnpm exec vitest run tests/tour/liveWebdav.test.ts
 * 安全：只写入专用沙盒目录 E2E_SANDBOX（默认 /fastReader-e2e），不删除任何内容，不打印凭据。
 * Cloudflare 运行时用本机 http 服务模拟：把 functions/api/dav 的 onRequest 包成端点。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { WebDAVService, type WebDAVConfig } from '../../src/services/webdavService'
import { onRequest } from '../../functions/api/dav/[[path]].js'

// 浏览器里 getProcessedUrl 返回相对的 /api/dav；Node 下 webdav 库无法解析相对地址，
// 补成本机代理的绝对地址（仅替换这一个纯函数，其余真实代码不变）
vi.mock('../../src/services/webdav/utils', async (orig) => ({
  ...(await orig<typeof import('../../src/services/webdav/utils')>()),
  getProcessedUrl: () => 'http://localhost:38123/api/dav',
}))

const CONFIG_PATH = process.env.E2E_CONFIG
const SANDBOX = process.env.E2E_SANDBOX || '/fastReader-e2e'
const ORIGIN = 'http://localhost:38123'
const PORT = 38123

const live = describe.skipIf(!CONFIG_PATH)

function loadDavConfig(): WebDAVConfig {
  const raw = parse(readFileSync(CONFIG_PATH!, 'utf8'))
  const dav = raw?.config?.webdavConfig ?? raw?.webdavConfig ?? raw?.webdav
  if (!dav?.serverUrl || !dav?.username || !dav?.password) throw new Error('配置里没有完整的 WebDAV 凭据')
  return {
    serverUrl: dav.serverUrl,
    username: dav.username,
    password: dav.password,
    enabled: true,
    autoSync: true,
    syncPath: SANDBOX,
    browsePath: '/',
    appName: 'fastReader_e2e',
    connectionStatus: 'disconnected',
    lastSyncTime: null,
  }
}

let server: Server
const realFetch = globalThis.fetch

beforeAll(async () => {
  if (!CONFIG_PATH) return
  // Cloudflare Pages 运行时模拟：Node 请求 → Request → onRequest → Response
  server = createServer(async (req, res) => {
    try {
      const method = req.method || 'GET'
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
        else if (v !== undefined) headers.set(k, v)
      }
      const hasBody = method !== 'GET' && method !== 'HEAD'
      const request = new Request(`http://localhost:${PORT}${req.url}`, {
        method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        // @ts-expect-error Node fetch 流式请求体需要 duplex
        duplex: 'half',
      })
      const response: Response = await onRequest({ request, env: { ALLOWED_ORIGINS: ORIGIN } })
      // E2E_TRACE=1：打印 方法 / X-WebDAV-Path / Depth / 状态码（不含任何凭据）
      if (process.env.E2E_TRACE) {
        console.log(
          `[trace] ${method} path=${headers.get('x-webdav-path')} depth=${headers.get('depth') ?? '-'} -> ${response.status}`
        )
      }
      const out: Record<string, string> = {}
      response.headers.forEach((v, k) => (out[k] = v))
      res.writeHead(response.status, out)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  await new Promise<void>((r) => server.listen(PORT, r))
  // 浏览器里的相对地址（/api/dav）在 Node 中无法解析：补上 origin
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) input = ORIGIN + input
    return realFetch(input as RequestInfo, init)
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  if (server) await new Promise((r) => server.close(r))
})

live('真实 WebDAV（经真实代理代码）', () => {
  let svc: WebDAVService
  const stamp = Date.now().toString(36)

  beforeAll(async () => {
    svc = new WebDAVService()
    const res = await svc.initialize(loadDavConfig())
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
  }, 60_000)

  it('沙盒目录已创建，existsStatus 区分 exists / missing', async () => {
    expect(await svc.existsStatus(SANDBOX)).toBe('exists')
    expect(await svc.existsStatus(`${SANDBOX}/__missing-${stamp}__`)).toBe('missing')
  }, 60_000)

  it('文本上传 → 下载往返一致，并出现在目录列表与 stat 中', async () => {
    const path = `${SANDBOX}/hello-${stamp}.md`
    const text = `# 联调\n\n中文与 emoji 🙂 ${stamp}\n`
    const up = await svc.putFileContents(path, text, true)
    expect(up.error).toBeUndefined()
    expect(up.success).toBe(true)

    const down = await svc.getFileContents(path, 'text')
    expect(down.success).toBe(true)
    expect(down.data).toBe(text)

    const list = await svc.getDirectoryContents(SANDBOX)
    expect(list.success).toBe(true)
    expect(list.data?.some((f) => f.basename === `hello-${stamp}.md`)).toBe(true)

    const stat = await svc.getStat(path)
    expect(stat.success).toBe(true)
    expect(stat.data?.size).toBe(Buffer.byteLength(text))
  }, 60_000)

  it('二进制（1MB 随机字节）经代理往返后哈希一致', async () => {
    const bytes = randomBytes(1024 * 1024)
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const path = `${SANDBOX}/bin-${stamp}.bin`
    const up = await svc.putFileContents(path, buf, true)
    expect(up.success).toBe(true)

    const down = await svc.getFileContents(path, 'binary')
    expect(down.success).toBe(true)
    const got = Buffer.from(down.data as ArrayBuffer)
    expect(got.length).toBe(bytes.length)
    expect(createHash('sha256').update(got).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
  }, 120_000)

  it('不覆盖时重复上传同一路径被拒绝', async () => {
    const path = `${SANDBOX}/once-${stamp}.txt`
    expect((await svc.putFileContents(path, 'a', false)).success).toBe(true)
    const again = await svc.putFileContents(path, 'b', false)
    expect(again.success).toBe(false)
    // 内容保持第一次写入
    expect((await svc.getFileContents(path, 'text')).data).toBe('a')
  }, 60_000)

  it('syncFiles 批量上传导图文件，按子目录落位', async () => {
    const res = await svc.syncFiles([
      { name: `m1-${stamp}.json`, content: '{"a":1}', path: `book-${stamp}/mindmaps/m1.json` },
      { name: `m2-${stamp}.json`, content: '{"b":2}', path: `book-${stamp}/m2.json` },
    ])
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(await svc.existsStatus(`${SANDBOX}/book-${stamp}/mindmaps/m1.json`)).toBe('exists')
    expect(await svc.existsStatus(`${SANDBOX}/book-${stamp}/m2.json`)).toBe('exists')
  }, 120_000)

  it('错误密码：初始化失败且给出可读原因；探测结果为 unknown 而不是 missing', async () => {
    const bad = new WebDAVService()
    const res = await bad.initialize({ ...loadDavConfig(), password: 'definitely-wrong-password' })
    expect(res.success).toBe(false)
    expect(String(res.error)).not.toMatch(/definitely-wrong-password/) // 错误信息不泄露口令
    expect(await bad.existsStatus(`${SANDBOX}/anything`)).toBe('unknown')
  }, 60_000)

  it('代理自身拒绝（Origin 不在白名单）带 X-Proxy-Error，且不会被当作上游结果', async () => {
    const cfg = loadDavConfig()
    const res = await realFetch(`${ORIGIN}/api/dav/`, {
      method: 'PROPFIND',
      headers: {
        Origin: 'https://evil.example',
        Authorization: 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64'),
        'X-WebDAV-Base': cfg.serverUrl,
        'X-WebDAV-Path': '/',
        Depth: '0',
      },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('x-proxy-error')).toBe('1')
  }, 30_000)

  it('路径逃逸被代理拒绝：绝对 URL 形式的 X-WebDAV-Path 不会请求其他主机', async () => {
    const cfg = loadDavConfig()
    const res = await realFetch(`${ORIGIN}/api/dav/`, {
      method: 'GET',
      headers: {
        Origin: ORIGIN,
        Authorization: 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64'),
        'X-WebDAV-Base': cfg.serverUrl,
        'X-WebDAV-Path': 'http://169.254.169.254/latest/meta-data/',
      },
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('x-proxy-error')).toBe('1')
  }, 30_000)
})
