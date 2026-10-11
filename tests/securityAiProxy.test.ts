// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/ai/[[path]].js'

const ORIGIN = 'https://fast-read.pages.dev'
const BASE = 'https://api.example.com/v1'

let fetchMock: ReturnType<typeof vi.fn>

function aiRequest(opts: { path?: string; base?: string; headers?: Record<string, string>; method?: string } = {}) {
  const url = new URL('https://fast-read.pages.dev/api/ai')
  url.searchParams.set('path', opts.path ?? 'chat/completions')
  const method = opts.method ?? 'POST'
  return onRequest({
    request: new Request(url, {
      method,
      headers: {
        Origin: ORIGIN,
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
        'X-AI-Base': opts.base ?? BASE,
        ...(opts.headers || {}),
      },
      body: method === 'POST' ? '{"model":"m"}' : undefined,
    }),
    env: {},
  }) as Promise<Response>
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': 'sid=1', 'retry-after': '3' },
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI 代理', () => {
  it('正常请求透传到 base/path，去掉内部头与上游 Set-Cookie', async () => {
    const res = await aiRequest()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')
    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.url).toBe('https://api.example.com/v1/chat/completions')
    expect(req.headers.get('authorization')).toBe('Bearer sk-test')
    expect(req.headers.get('x-ai-base')).toBeNull()
    expect(req.headers.get('x-request-origin')).toBeNull()
    expect(await req.text()).toBe('{"model":"m"}')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('retry-after')).toBe('3')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it.each(['http://evil.com/x', 'https://evil.com/x', '//evil.com/x', '\\\\evil.com\\x', '../../x'])(
    '拒绝逃逸 path %s',
    async (path) => {
      const res = await aiRequest({ path })
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([
    'http://api.example.com/v1',
    'https://127.0.0.1:11434',
    'https://localhost:11434',
    'https://[::1]/v1',
    'https://169.254.169.254/latest',
    'https://10.0.0.8/v1',
    'https://u:p@api.example.com/v1',
  ])('拒绝 http / 私网 / 带凭据 base %s', async (base) => {
    const res = await aiRequest({ base })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('用户自定义的公网 https 服务商可用（不做主机白名单）', async () => {
    const res = await aiRequest({ base: 'https://my-llm.example.net/openai', path: 'chat/completions' })
    expect(res.status).toBe(200)
    expect((fetchMock.mock.calls[0][0] as Request).url).toBe('https://my-llm.example.net/openai/chat/completions')
  })

  it('Origin 不在白名单时，伪造 X-Request-Origin 不能放行', async () => {
    const res = await aiRequest({ headers: { Origin: 'https://evil.com', 'X-Request-Origin': ORIGIN } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('无 Origin 时回退 X-Request-Origin；两者皆无 403', async () => {
    const make = (headers: Record<string, string>) =>
      onRequest({
        request: new Request('https://fast-read.pages.dev/api/ai?path=chat%2Fcompletions', {
          method: 'POST',
          headers: { 'X-AI-Base': BASE, ...headers },
          body: '{}',
        }),
        env: {},
      })
    expect((await make({ 'X-Request-Origin': ORIGIN })).status).toBe(200)
    expect((await make({})).status).toBe(403)
  })

  it('OPTIONS 204、非法方法 405', async () => {
    expect((await aiRequest({ method: 'OPTIONS' })).status).toBe(204)
    expect((await aiRequest({ method: 'DELETE' })).status).toBe(405)
  })
})
