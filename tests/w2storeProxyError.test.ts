// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/dav/[[path]].js'
import { createEnv } from './__mocks__/memoryKv'

const ORIGIN = 'https://fast-read.pages.dev'
const BASE = 'https://dav.example.com/dav/'

type Env = ReturnType<typeof createEnv>

/** WebDAV 上游地址与凭据只在服务端（state:webdav）：客户端无法指定 */
async function seedWebdav(env: Env, overrides: { serverUrl?: string; password?: string } = {}) {
  await env.FASTREADER_KV.put(
    'state:webdav',
    JSON.stringify({
      rev: 1,
      updatedAt: new Date().toISOString(),
      data: {
        enabled: true,
        serverUrl: overrides.serverUrl ?? BASE,
        username: 'demo-user',
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

async function readyEnv(overrides?: { serverUrl?: string; password?: string }): Promise<Env> {
  const env = createEnv()
  await seedWebdav(env, overrides)
  return env
}

function req(
  env: Env,
  headers: Record<string, string> = {},
  method = 'GET',
  body?: BodyInit
) {
  const init: RequestInit = {
    method,
    headers: { Origin: ORIGIN, 'X-WebDAV-Path': '/a', ...headers },
  }
  if (body !== undefined) init.body = body
  return onRequest({
    request: new Request('https://fast-read.pages.dev/api/dav/', init),
    env,
  }) as Promise<Response>
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('DAV 代理：X-Proxy-Error 标识', () => {
  it('代理自身错误（405/403/400/413）都带 X-Proxy-Error 且暴露该头', async () => {
    const env = await readyEnv()
    const cases: Array<[Response, number]> = [
      [await req(env, {}, 'PATCH'), 405],
      [await req(env, { Origin: 'https://evil.com' }), 403],
      // 服务端配置的上游不是合法 https 地址
      [await req(await readyEnv({ serverUrl: 'http://insecure.example.com/dav/' })), 400],
      // 路径越出 base 作用域
      [await req(env, { 'X-WebDAV-Path': '/a/../../x%2f..%2f..' }), 400],
      [await req(env, { 'Content-Length': String(60 * 1024 * 1024) }), 413],
    ]
    for (const [res, status] of cases) {
      expect(res.status).toBe(status)
      expect(res.headers.get('X-Proxy-Error')).toBe('1')
      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Proxy-Error')
    }
  })

  it('服务端未配置 WebDAV 时返回 400 + X-Proxy-Error（不再接受客户端自带 base）', async () => {
    // 客户端仍可伪造旧头，但代理不再读取
    const res = await req(createEnv(), { 'X-WebDAV-Base': BASE })
    expect(res.status).toBe(400)
    expect(res.headers.get('X-Proxy-Error')).toBe('1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('上游不可达返回 502 + X-Proxy-Error（含重定向跟随阶段）', async () => {
    const env = await readyEnv()
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await req(env)
    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Error')).toBe('1')

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${BASE}b` } }))
      .mockRejectedValueOnce(new Error('boom'))
    const res2 = await req(env)
    expect(res2.status).toBe(502)
    expect(res2.headers.get('X-Proxy-Error')).toBe('1')
  })

  it('上游自身的 403 不带 X-Proxy-Error', async () => {
    const res = await req(await readyEnv())
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Proxy-Error')).toBeNull()
  })
})
