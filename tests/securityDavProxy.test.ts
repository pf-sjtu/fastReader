// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/dav/[[path]].js'
import { createEnv } from './__mocks__/memoryKv'

const ORIGIN = 'https://fast-read.pages.dev'
const BASE = 'https://dav.example.com/dav/'
const CREDENTIALS = 'ZGVtby11c2VyOmRlbW8tcGFzcw==' // demo-user:demo-pass

type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock

/** 把 WebDAV 配置写进共享状态（凭据只存在于服务端） */
async function seedWebdav(
  env: ReturnType<typeof createEnv>,
  overrides: { serverUrl?: string; username?: string; password?: string } = {}
) {
  await env.FASTREADER_KV.put(
    'state:webdav',
    JSON.stringify({
      rev: 1,
      updatedAt: new Date().toISOString(),
      data: {
        enabled: true,
        serverUrl: overrides.serverUrl ?? BASE,
        username: overrides.username ?? 'demo-user',
        password: overrides.password ?? 'demo-pass',
        appName: 'fastReader_by_PF',
        autoSync: false,
        syncPath: '/fastReader',
        browsePath: '/',
        lastSyncTime: null,
        connectionStatus: 'connected',
      },
    })
  )
}

function davRequest(opts: {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: BodyInit | null
  env?: ReturnType<typeof createEnv>
  omitOrigin?: boolean
} = {}) {
  const headers: Record<string, string> = {
    Authorization: 'Basic Y2xpZW50OnN1cHBsaWVk',
    'X-WebDAV-Base': 'https://attacker.example/dav/',
    'X-WebDAV-Path': opts.path ?? '/Books/a.md',
    ...(opts.omitOrigin ? {} : { Origin: ORIGIN }),
    ...(opts.headers || {}),
  }
  for (const key of Object.keys(headers)) if (headers[key] === '') delete headers[key]

  const init: RequestInit & { duplex?: string } = { method: opts.method ?? 'GET', headers }
  if (opts.body !== undefined) {
    init.body = opts.body
    init.duplex = 'half'
  }
  return onRequest({
    request: new Request('https://fast-read.pages.dev/api/dav/', init),
    env: opts.env ?? createEnv(),
  }) as Promise<Response>
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

describe('DAV 代理：服务端配置与凭据', () => {
  it('用服务端保存的 base 与凭据转发，忽略客户端自带的 base 与 Authorization', async () => {
    const env = createEnv()
    await seedWebdav(env)

    const res = await davRequest({ path: '/Books/%E4%B8%AD.md', env })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')

    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.url).toBe('https://dav.example.com/dav/Books/%E4%B8%AD.md')
    expect(req.headers.get('authorization')).toBe(`Basic ${CREDENTIALS}`)
    expect(req.headers.get('x-webdav-base')).toBeNull()
    expect(req.headers.get('x-webdav-path')).toBeNull()
    expect(req.headers.get('origin')).toBeNull()
  })

  it('未配置 WebDAV 时 400，不发起上游请求', async () => {
    const res = await davRequest({ env: createEnv() })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('有地址但缺凭据时 400', async () => {
    const env = createEnv()
    await seedWebdav(env, { password: '' })
    const res = await davRequest({ env })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('KV 未绑定 500', async () => {
    const res = await davRequest({ env: {} as never })
    expect(res.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DAV 代理：路径作用域', () => {
  it.each([
    'http://evil.com/x',
    'https://evil.com/x',
    '///evil.com/x',
    '//evil.com/x',
    '\\\\evil.com\\x',
    '/\\\\evil.com/x',
    '/../../secret',
  ])('拒绝逃逸路径 %s（400，不发起上游请求）', async (path) => {
    const env = createEnv()
    await seedWebdav(env)
    const res = await davRequest({ path, env })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('query 方式的 path 同样受校验', async () => {
    const env = createEnv()
    await seedWebdav(env)
    const url = `https://fast-read.pages.dev/api/dav?path=${encodeURIComponent('https://evil.com/')}`
    const res = await onRequest({ request: new Request(url, { headers: { Origin: ORIGIN } }), env })
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
  ])('服务端配置成私网 / 非 https base 时拒绝 %s', async (serverUrl) => {
    const env = createEnv()
    await seedWebdav(env, { serverUrl })
    const res = await davRequest({ env })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DAV 代理：重定向', () => {
  it('同源且在 base 下的重定向跟随一次并继续带凭据', async () => {
    const env = createEnv()
    await seedWebdav(env)
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/dav/Books/b.md' } }))
      .mockResolvedValueOnce(new Response('moved', { status: 200 }))

    const res = await davRequest({ env })
    expect(res.status).toBe(200)
    expect(calledUrls()).toEqual([
      'https://dav.example.com/dav/Books/a.md',
      'https://dav.example.com/dav/Books/b.md',
    ])
    expect((fetchMock.mock.calls[1][0] as Request).headers.get('authorization')).toBe(`Basic ${CREDENTIALS}`)
  })

  it.each([
    'https://evil.com/steal',
    '//evil.com/steal',
    'http://dav.example.com/dav/x',
    'https://dav.example.com/other/x',
    'https://169.254.169.254/latest/meta-data',
  ])('越界重定向 %s 不跟随、不外发凭据、不回传 location', async (location) => {
    const env = createEnv()
    await seedWebdav(env)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))

    const res = await davRequest({ env })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('DAV 代理：响应头白名单', () => {
  it('只回传白名单头，丢弃 Set-Cookie 等', async () => {
    const env = createEnv()
    await seedWebdav(env)
    fetchMock.mockResolvedValueOnce(
      new Response('<xml/>', {
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
      })
    )
    const res = await davRequest({ method: 'PROPFIND', env })
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

  it('上游压缩（content-encoding）时丢弃 content-length；未压缩时保留', async () => {
    const env = createEnv()
    await seedWebdav(env)
    // fetch 已解码正文，但上游 content-length 是压缩后的长度：透传会让客户端截断正文（真实 WebDAV 联调中暴露）
    fetchMock.mockResolvedValueOnce(
      new Response('<xml>decoded body longer than header</xml>', {
        status: 207,
        headers: { 'content-type': 'application/xml', 'content-encoding': 'gzip', 'content-length': '12' },
      })
    )
    let res = await davRequest({ method: 'PROPFIND', env })
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toContain('decoded body longer')

    fetchMock.mockResolvedValueOnce(
      new Response('abcdef', { status: 200, headers: { 'content-length': '6', 'content-encoding': 'identity' } })
    )
    res = await davRequest({ method: 'GET', env })
    expect(res.headers.get('content-length')).toBe('6')
  })

  it('非 3xx 的 location 仅在同源作用域内保留', async () => {
    const env = createEnv()
    await seedWebdav(env)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: '/dav/Books/a.md' } }))
    let res = await davRequest({ method: 'PUT', body: 'x', env })
    expect(res.headers.get('location')).toBe('https://dav.example.com/dav/Books/a.md')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: 'https://evil.com/a' } }))
    res = await davRequest({ method: 'PUT', body: 'x', env })
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('DAV 代理：请求体上限', () => {
  const LIMIT = 50 * 1024 * 1024

  it('Content-Length 超限直接 413，不读 body、不请求上游', async () => {
    const env = createEnv()
    await seedWebdav(env)
    const res = await davRequest({
      method: 'PUT',
      headers: { 'Content-Length': String(LIMIT + 1) },
      body: 'small',
      env,
    })
    expect(res.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('无 Content-Length 的流式 body 实际超限也 413', async () => {
    const env = createEnv()
    await seedWebdav(env)
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
    const res = await davRequest({ method: 'PUT', body: stream, env })
    expect(res.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正常大小 body 原样透传', async () => {
    const env = createEnv()
    await seedWebdav(env)
    const res = await davRequest({ method: 'PUT', body: 'hello', env })
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
    const env = createEnv()
    await seedWebdav(env)
    const res = await davRequest({ headers: { Origin: 'https://evil.com', 'X-Request-Origin': ORIGIN }, env })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('无 Origin 时用 X-Request-Origin 回退；两者皆无视为同站请求放行', async () => {
    const env = createEnv()
    await seedWebdav(env)
    const fallback = await davRequest({ omitOrigin: true, headers: { 'X-Request-Origin': ORIGIN }, env })
    expect(fallback.status).toBe(200)

    // 无 Origin 且无 X-Request-Origin：浏览器同站请求（会话 Cookie 已由中间件校验）
    const bare = await davRequest({ omitOrigin: true, env })
    expect(bare.status).toBe(200)
  })

  it('ALLOWED_ORIGINS 环境变量追加白名单', async () => {
    const env = createEnv({ ALLOWED_ORIGINS: 'https://custom.example.org, ' })
    await seedWebdav(env)
    const res = await davRequest({ headers: { Origin: 'https://custom.example.org' }, env })
    expect(res.status).toBe(200)
  })
})
