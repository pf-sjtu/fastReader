// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/dav/[[path]].js'

const ORIGIN = 'https://fast-read.pages.dev'
const BASE = 'https://dav.example.com/dav/'

type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock

function davRequest(opts: {
  method?: string
  path?: string
  base?: string
  headers?: Record<string, string>
  body?: BodyInit | null
} = {}) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    Authorization: 'Basic dXNlcjpwYXNz',
    'X-WebDAV-Base': opts.base ?? BASE,
    'X-WebDAV-Path': opts.path ?? '/Books/a.md',
    ...(opts.headers || {}),
  }
  const init: RequestInit & { duplex?: string } = { method: opts.method ?? 'GET', headers }
  if (opts.body !== undefined) {
    init.body = opts.body
    init.duplex = 'half'
  }
  return onRequest({ request: new Request('https://fast-read.pages.dev/api/dav/', init), env: {} }) as Promise<Response>
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => (c[0] as Request).url)
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DAV 代理：路径作用域', () => {
  it('正常请求透传到 base 下，并带 Authorization、去掉内部头', async () => {
    const res = await davRequest({ path: '/Books/%E4%B8%AD.md' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.url).toBe('https://dav.example.com/dav/Books/%E4%B8%AD.md')
    expect(req.headers.get('authorization')).toBe('Basic dXNlcjpwYXNz')
    expect(req.headers.get('x-webdav-base')).toBeNull()
    expect(req.headers.get('origin')).toBeNull()
  })

  it.each([
    'http://evil.com/x',
    'https://evil.com/x',
    '///evil.com/x',
    '//evil.com/x',
    '\\\\evil.com\\x',
    '/\\\\evil.com/x',
    '/../../secret',
  ])('拒绝逃逸路径 %s（400，不发起上游请求）', async (path) => {
    const res = await davRequest({ path })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('query 方式的 path 同样受校验', async () => {
    const url = `https://fast-read.pages.dev/api/dav?base=${encodeURIComponent(BASE)}&path=${encodeURIComponent('https://evil.com/')}`
    const res = await onRequest({ request: new Request(url, { headers: { Origin: ORIGIN } }), env: {} })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'https://127.0.0.1/dav/',
    'https://2130706433/dav/',
    'https://[::ffff:127.0.0.1]/dav/',
    'https://[::]/dav/',
    'https://[fe80::1]/dav/',
    'https://192.168.1.2/dav/',
    'http://dav.example.com/dav/',
  ])('拒绝私网 / 非 https base %s', async (base) => {
    const res = await davRequest({ base })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DAV 代理：重定向', () => {
  it('同源且在 base 下的重定向跟随一次', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/dav/Books/b.md' } }))
      .mockResolvedValueOnce(new Response('moved', { status: 200 }))
    const res = await davRequest()
    expect(res.status).toBe(200)
    expect(calledUrls()).toEqual([
      'https://dav.example.com/dav/Books/a.md',
      'https://dav.example.com/dav/Books/b.md',
    ])
    expect((fetchMock.mock.calls[1][0] as Request).headers.get('authorization')).toBe('Basic dXNlcjpwYXNz')
  })

  it.each([
    'https://evil.com/steal',
    '//evil.com/steal',
    'http://dav.example.com/dav/x',
    'https://dav.example.com/other/x',
    'https://169.254.169.254/latest/meta-data',
  ])('越界重定向 %s 不跟随、不外发凭据、不回传 location', async (location) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
    const res = await davRequest()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('DAV 代理：响应头白名单', () => {
  it('只回传白名单头，丢弃 Set-Cookie 等', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<xml/>', {
      status: 207,
      headers: {
        'content-type': 'application/xml',
        etag: '"abc"',
        'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
        dav: '1, 2',
        'accept-ranges': 'bytes',
        'content-range': 'bytes 0-5/6',
        'set-cookie': 'sid=secret',
        'x-powered-by': 'nginx',
        'www-authenticate': 'Basic realm="x"',
      },
    }))
    const res = await davRequest({ method: 'PROPFIND' })
    expect(res.status).toBe(207)
    expect(res.headers.get('content-type')).toBe('application/xml')
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('dav')).toBe('1, 2')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-range')).toBe('bytes 0-5/6')
    expect(res.headers.get('last-modified')).toBeTruthy()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('x-powered-by')).toBeNull()
    expect(res.headers.get('www-authenticate')).toBeNull()
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('非 3xx 的 location 仅在同源作用域内保留', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: '/dav/Books/a.md' } }))
    let res = await davRequest({ method: 'PUT', body: 'x' })
    expect(res.headers.get('location')).toBe('/dav/Books/a.md')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: 'https://evil.com/a' } }))
    res = await davRequest({ method: 'PUT', body: 'x' })
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('DAV 代理：请求体上限', () => {
  const LIMIT = 50 * 1024 * 1024

  it('Content-Length 超限直接 413，不读 body、不请求上游', async () => {
    const res = await davRequest({
      method: 'PUT',
      headers: { 'Content-Length': String(LIMIT + 1) },
      body: 'small',
    })
    expect(res.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('无 Content-Length 的流式 body 实际超限也 413', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > LIMIT) {
          controller.close()
          return
        }
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const res = await davRequest({ method: 'PUT', body: stream })
    expect(res.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正常大小 body 原样透传', async () => {
    const res = await davRequest({ method: 'PUT', body: 'hello' })
    expect(res.status).toBe(200)
    const req = fetchMock.mock.calls[0][0] as Request
    expect(await req.text()).toBe('hello')
  })
})

describe('DAV 代理：Origin 与方法', () => {
  it('OPTIONS 预检返回 204', async () => {
    const res = await davRequest({ method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('非白名单方法 405', async () => {
    const res = await davRequest({ method: 'PATCH' })
    expect(res.status).toBe(405)
  })

  it('Origin 不在白名单时，即使 X-Request-Origin 合法也 403', async () => {
    const res = await davRequest({ headers: { Origin: 'https://evil.com', 'X-Request-Origin': ORIGIN } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('无 Origin 时回退 X-Request-Origin；两者皆无 403', async () => {
    const ok = await onRequest({
      request: new Request('https://fast-read.pages.dev/api/dav/', {
        headers: { 'X-Request-Origin': ORIGIN, 'X-WebDAV-Base': BASE, 'X-WebDAV-Path': '/a' },
      }),
      env: {},
    })
    expect(ok.status).toBe(200)
    const denied = await onRequest({
      request: new Request('https://fast-read.pages.dev/api/dav/', {
        headers: { 'X-WebDAV-Base': BASE, 'X-WebDAV-Path': '/a' },
      }),
      env: {},
    })
    expect(denied.status).toBe(403)
  })

  it('ALLOWED_ORIGINS 环境变量追加白名单', async () => {
    const res = await onRequest({
      request: new Request('https://x/api/dav/', {
        headers: { Origin: 'https://custom.example.org', 'X-WebDAV-Base': BASE, 'X-WebDAV-Path': '/a' },
      }),
      env: { ALLOWED_ORIGINS: 'https://custom.example.org, ' },
    })
    expect(res.status).toBe(200)
  })
})
