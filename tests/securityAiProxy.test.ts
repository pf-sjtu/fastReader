// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest } from '../functions/api/ai/[[path]].js'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest as modelsHandler } from '../functions/api/providers/models.js'
import { createEnv } from './__mocks__/memoryKv'

const ORIGIN = 'https://fast-read.pages.dev'

type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock

/** 把服务商写进共享状态（含明文密钥，模拟服务端保存态） */
async function seedProvider(
  env: ReturnType<typeof createEnv>,
  provider: { id: string; baseUrl: string; apiKey?: string; type?: string; name?: string }
) {
  await env.FASTREADER_KV.put(
    'state:ai',
    JSON.stringify({
      rev: 1,
      updatedAt: new Date().toISOString(),
      data: {
        providers: [
          {
            id: provider.id,
            name: provider.name ?? provider.id,
            type: provider.type ?? 'openai',
            baseUrl: provider.baseUrl,
            ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
            models: [{ id: 'm', enabled: true, source: 'manual' }],
          },
        ],
        active: { providerId: provider.id, modelId: 'm' },
        defaultTemperature: 0.7,
      },
    })
  )
}

function aiRequest(opts: {
  path?: string
  providerId?: string
  headers?: Record<string, string>
  method?: string
  env?: ReturnType<typeof createEnv>
  omitOrigin?: boolean
} = {}) {
  const url = new URL('https://fast-read.pages.dev/api/ai')
  url.searchParams.set('path', opts.path ?? 'chat/completions')
  const method = opts.method ?? 'POST'
  const headers: Record<string, string> = {
    Authorization: 'Bearer sk-client-supplied',
    'Content-Type': 'application/json',
    'X-Provider-Id': opts.providerId ?? 'p1',
    ...(opts.omitOrigin ? {} : { Origin: ORIGIN }),
    ...(opts.headers || {}),
  }
  for (const key of Object.keys(headers)) if (headers[key] === '') delete headers[key]

  return onRequest({
    request: new Request(url, {
      method,
      headers,
      body: method === 'POST' ? '{"model":"m"}' : undefined,
    }),
    env: opts.env ?? createEnv(),
  }) as Promise<Response>
}

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'sid=1', 'retry-after': '3' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI 代理：服务端凭据', () => {
  it('用服务端保存的 base + Key 转发，丢弃客户端自带的 Authorization', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://navira.example/v1', apiKey: 'sk-server-side' })

    const res = await aiRequest({ env })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')

    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.url).toBe('https://navira.example/v1/chat/completions')
    expect(req.headers.get('authorization')).toBe('Bearer sk-server-side')
    expect(req.headers.get('x-provider-id')).toBeNull()
    expect(req.headers.get('origin')).toBeNull()
    expect(await req.text()).toBe('{"model":"m"}')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('retry-after')).toBe('3')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('gemini 协议用 x-goog-api-key 而不是 Bearer', async () => {
    const env = createEnv()
    await seedProvider(env, {
      id: 'g1',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'g-key',
    })
    const res = await aiRequest({ env, providerId: 'g1', path: 'models/gemini-2.5-flash:generateContent' })
    expect(res.status).toBe(200)
    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.headers.get('x-goog-api-key')).toBe('g-key')
    expect(req.headers.get('authorization')).toBeNull()
  })

  it('客户端无法通过请求头覆盖服务端密钥', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://navira.example/v1', apiKey: 'sk-server-side' })
    await aiRequest({
      env,
      headers: { Authorization: 'Bearer attacker-key', 'x-goog-api-key': 'attacker' },
    })
    const req = fetchMock.mock.calls[0][0] as Request
    expect(req.headers.get('authorization')).toBe('Bearer sk-server-side')
    expect(req.headers.get('x-goog-api-key')).toBeNull()
  })

  it('未知服务商 400，不发起上游请求', async () => {
    const res = await aiRequest({ providerId: 'nope' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_provider' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('缺少 X-Provider-Id 400', async () => {
    const res = await aiRequest({ providerId: '' })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('KV 未绑定 500', async () => {
    const res = await aiRequest({ env: {} as never })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'kv_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AI 代理：路径作用域', () => {
  beforeEach(async () => {
    // 每个用例都需要一个可用的服务商
  })

  it.each(['http://evil.com/x', 'https://evil.com/x', '//evil.com/x', '\\\\evil.com\\x', '../../x'])(
    '拒绝逃逸 path %s',
    async (path) => {
      const env = createEnv()
      await seedProvider(env, { id: 'p1', baseUrl: 'https://api.example.com/v1', apiKey: 'k' })
      const res = await aiRequest({ env, path })
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
  ])('服务商 baseUrl 非法（http/私网/带凭据）时拒绝 %s', async (baseUrl) => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl, apiKey: 'k' })
    const res = await aiRequest({ env })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('用户自定义的公网 https 服务商可用（不做主机白名单）', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://my-llm.example.net/openai', apiKey: 'k' })
    const res = await aiRequest({ env, path: 'chat/completions' })
    expect(res.status).toBe(200)
    expect((fetchMock.mock.calls[0][0] as Request).url).toBe(
      'https://my-llm.example.net/openai/chat/completions'
    )
  })
})

describe('AI 代理：Origin 与方法', () => {
  it('Origin 不在白名单时，伪造 X-Request-Origin 不能放行', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://api.example.com/v1', apiKey: 'k' })
    const res = await aiRequest({ env, headers: { Origin: 'https://evil.com', 'X-Request-Origin': ORIGIN } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ALLOWED_ORIGINS 可追加白名单', async () => {
    const env = createEnv({ ALLOWED_ORIGINS: 'https://custom.example.org' })
    await seedProvider(env, { id: 'p1', baseUrl: 'https://api.example.com/v1', apiKey: 'k' })
    const res = await aiRequest({ env, headers: { Origin: 'https://custom.example.org' } })
    expect(res.status).toBe(200)
  })

  it('无 Origin（同源同站请求）放行', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://api.example.com/v1', apiKey: 'k' })
    const res = await aiRequest({ env, omitOrigin: true })
    expect(res.status).toBe(200)
  })

  it('OPTIONS 204、非法方法 405', async () => {
    expect((await aiRequest({ method: 'OPTIONS' })).status).toBe(204)
    expect((await aiRequest({ method: 'DELETE' })).status).toBe(405)
  })
})

describe('AI 代理：上游模型列表', () => {
  function modelsRequest(body: unknown, env = createEnv()) {
    return modelsHandler({
      request: new Request('https://fast-read.pages.dev/api/providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    }) as Promise<Response>
  }

  it('用已保存服务商的 base 与 Key 拉取 /models', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://navira.example/v1', apiKey: 'sk-server-side' })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }, { id: 'gpt-a' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const res = await modelsRequest({ providerId: 'p1' }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: ['gpt-a', 'gpt-b'], count: 2 })
    const req = fetchMock.mock.calls[0][0] as string
    expect(req).toBe('https://navira.example/v1/models')
  })

  it('新服务商可直接用表单里的 baseUrl + apiKey 探测', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'x' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    )
    const res = await modelsRequest({ baseUrl: 'https://new.example/v1', apiKey: 'k' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ models: ['x'] })
  })

  it('gemini 的 models 响应去掉 models/ 前缀', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const res = await modelsRequest({ type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'k' })
    expect(await res.json()).toMatchObject({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] })
  })

  it('Ollama 提示浏览器直连（服务端不可达）', async () => {
    const res = await modelsRequest({ type: 'ollama', baseUrl: 'http://localhost:11434' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ollama_use_direct' })
  })

  it('拒绝私网 / 非 https base', async () => {
    const res = await modelsRequest({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'k' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_base_url' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('带 providerId 且未自带 Key 时，客户端指定的 baseUrl 被忽略（否则等于把服务端 Key 送给任意域名）', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://navira.example/v1', apiKey: 'sk-server-side' })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'gpt-a' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const res = await modelsRequest({ providerId: 'p1', baseUrl: 'https://evil.example/v1' }, env)
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://navira.example/v1/models')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-server-side')
    expect(JSON.stringify(init.headers)).not.toContain('evil.example')
  })

  it('自带新 Key 时允许用它指定的 baseUrl（向导里填新端点）', async () => {
    const env = createEnv()
    await seedProvider(env, { id: 'p1', baseUrl: 'https://navira.example/v1', apiKey: 'sk-server-side' })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    )
    await modelsRequest({ providerId: 'p1', baseUrl: 'https://other.example/v1', apiKey: 'sk-user-typed' }, env)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://other.example/v1/models')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-user-typed')
  })

  it('上游 401 时把错误透出而不是编造模型列表', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"bad key"}', { status: 401 }))
    const res = await modelsRequest({ baseUrl: 'https://new.example/v1', apiKey: 'bad' })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'upstream_failed' })
  })
})
