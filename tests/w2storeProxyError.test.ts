// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/dav/[[path]].js'

const ORIGIN = 'https://fast-read.pages.dev'
const BASE = 'https://dav.example.com/dav/'

function req(headers: Record<string, string> = {}, method = 'GET') {
  return onRequest({
    request: new Request('https://fast-read.pages.dev/api/dav/', {
      method,
      headers: { Origin: ORIGIN, 'X-WebDAV-Base': BASE, 'X-WebDAV-Path': '/a', ...headers },
    }),
    env: {},
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
    const cases: Array<[Response, number]> = [
      [await req({}, 'PATCH'), 405],
      [await req({ Origin: 'https://evil.com' }), 403],
      [await req({ 'X-WebDAV-Base': 'http://insecure.example.com/' }), 400],
      [await req({ 'X-WebDAV-Path': '/a/../../x%2f..%2f..' }), 400],
      [await req({ 'Content-Length': String(60 * 1024 * 1024) }), 413],
    ]
    for (const [res, status] of cases) {
      expect(res.status).toBe(status)
      expect(res.headers.get('X-Proxy-Error')).toBe('1')
      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Proxy-Error')
    }
  })

  it('上游不可达返回 502 + X-Proxy-Error（含重定向跟随阶段）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await req()
    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Error')).toBe('1')

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${BASE}b` } }))
      .mockRejectedValueOnce(new Error('boom'))
    const res2 = await req()
    expect(res2.status).toBe(502)
    expect(res2.headers.get('X-Proxy-Error')).toBe('1')
  })

  it('上游自身的 403 不带 X-Proxy-Error', async () => {
    const res = await req()
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Proxy-Error')).toBeNull()
  })
})
