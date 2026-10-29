/**
 * 共享状态服务端：登录与会话、乐观锁、秘密脱敏、追加合并。
 * 直接 import Functions 的 onRequest 构造 Request 测试（与既有 securityAiProxy 测试同一写法）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { onRequest as authHandler, __resetRateLimit } from '../functions/api/auth/[[action]].js'
import { onRequest as stateHandler } from '../functions/api/state/[[section]].js'
import { onRequest as middleware } from '../functions/_middleware.js'
import { SESSION_COOKIE, createSessionToken, passwordMatches } from '../functions/_lib/session.js'
import { maskSecrets, mergeSecrets } from '../functions/_lib/secrets.js'
import { createEnv } from './__mocks__/memoryKv'

interface CallOptions {
  method?: string
  body?: unknown
  cookie?: string
  headers?: Record<string, string>
}

beforeEach(() => {
  // 失败计数在 isolate 内是内存态：测试之间共享进程，必须显式清空
  __resetRateLimit()
})

function call(
  handler: (ctx: never) => Promise<Response>,
  path: string,
  env: unknown,
  opts: CallOptions & { host?: string } = {}
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.cookie) headers.Cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.cookie)}`
  const request = new Request(`https://${opts.host ?? 'app.example'}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  return handler({ request, env, next: async () => new Response('next', { status: 200 }) } as never)
}

/** 登录请走本机域名：未配置 APP_PASSWORD 时只有本机允许回落缺省密码 */
async function login(env: unknown, password: string) {
  return call(authHandler, '/api/auth/login', env, { body: { password }, host: 'localhost:8788' })
}

async function tokenFor(env: unknown) {
  return createSessionToken(env)
}

describe('登录与会话', () => {
  it('缺省密码 123456a 可登录并下发 HttpOnly 会话 Cookie', async () => {
    const env = createEnv()
    const res = await login(env, '123456a')
    expect(res.status).toBe(200)

    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
  })

  it('APP_PASSWORD 覆盖缺省密码', async () => {
    const env = createEnv({ APP_PASSWORD: 'secret-xyz' })
    expect((await login(env, '123456a')).status).toBe(401)
    expect((await login(env, 'secret-xyz')).status).toBe(200)
  })

  it('错误密码 401 且不下发 Cookie', async () => {
    const res = await login(createEnv(), 'wrong')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.json()).toEqual({ error: 'invalid_password' })
  })

  it('改密码后旧会话立即失效', async () => {
    const env = createEnv({ APP_PASSWORD: 'old-pass' })
    const token = await tokenFor(env)
    // 同一份 token，换成新密码的环境
    const rotated = { ...createEnv(), APP_PASSWORD: 'new-pass' }
    const res = await call(authHandler, '/api/auth/me', rotated, { cookie: token })
    expect(res.status).toBe(401)
  })

  it('伪造的会话 token 被拒绝', async () => {
    const env = createEnv()
    const real = await tokenFor(env)
    const forged = `${real.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    expect((await call(authHandler, '/api/auth/me', env, { cookie: forged })).status).toBe(401)
    expect((await call(authHandler, '/api/auth/me', env, { cookie: 'garbage' })).status).toBe(401)
  })

  it('登出清除 Cookie', async () => {
    const res = await call(authHandler, '/api/auth/logout', createEnv(), { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/)
  })

  it('连续失败超过阈值后返回 429', async () => {
    const env = createEnv()
    for (let i = 0; i < 10; i++) expect((await login(env, 'bad')).status).toBe(401)
    const res = await login(env, 'bad')
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('登录成功会清零失败计数', async () => {
    const env = createEnv()
    for (let i = 0; i < 5; i++) await login(env, 'bad')
    expect((await login(env, '123456a')).status).toBe(200)
    // 清零后仍能继续尝试 5 次而不是立刻 429
    for (let i = 0; i < 5; i++) expect((await login(env, 'bad')).status).toBe(401)
  })
})

describe('密码比较', () => {
  it('相等 / 不等 / 长度不同 / 非字符串', async () => {
    expect(await passwordMatches('123456a', '123456a')).toBe(true)
    expect(await passwordMatches('123456b', '123456a')).toBe(false)
    expect(await passwordMatches('1', '123456a')).toBe(false)
    expect(await passwordMatches(undefined as unknown as string, '123456a')).toBe(false)
  })
})

describe('未配置 APP_PASSWORD 时不允许公网登录', () => {
  it('生产域名 + 缺省密码 → 503，而不是悄悄用 123456a', async () => {
    const env = createEnv() // 没有 APP_PASSWORD
    const response = await authHandler({
      request: new Request('https://fast-read.pages.dev/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456a' }),
      }),
      env,
      next: async () => new Response('next'),
    } as never)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'password_not_configured' })
  })

  it('本机开发仍可用缺省密码', async () => {
    const env = createEnv()
    const response = await authHandler({
      request: new Request('http://localhost:8788/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456a' }),
      }),
      env,
      next: async () => new Response('next'),
    } as never)
    expect(response.status).toBe(200)
  })
})

describe('中间件保护 /api/*', () => {
  it('未登录访问 /api/state 返回 401 且不含数据', async () => {
    const env = createEnv()
    const res = await middleware({
      request: new Request('https://app.example/api/state'),
      env,
      next: async () => new Response(JSON.stringify({ sections: { ai: {} } }), { status: 200 }),
    } as never)
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('sections')
  })

  it('已登录放行', async () => {
    const env = createEnv()
    const token = await tokenFor(env)
    const res = await middleware({
      request: new Request('https://app.example/api/state', {
        headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      }),
      env,
      next: async () => new Response('ok', { status: 200 }),
    } as never)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('/api/auth/* 无需登录', async () => {
    const env = createEnv()
    const res = await middleware({
      request: new Request('https://app.example/api/auth/login', { method: 'POST' }),
      env,
      next: async () => new Response('login', { status: 200 }),
    } as never)
    expect(res.status).toBe(200)
  })

  it('非 /api 请求不拦（静态资源照常返回）', async () => {
    const res = await middleware({
      request: new Request('https://app.example/index.html'),
      env: createEnv(),
      next: async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('共享状态读写', () => {
  let env: ReturnType<typeof createEnv>
  let cookie: string

  beforeEach(async () => {
    env = createEnv()
    cookie = await tokenFor(env)
  })

  it('空状态报告 initialized=false', async () => {
    const res = await call(stateHandler, '/api/state', env, { cookie })
    const body = await res.json()
    expect(body.initialized).toBe(false)
    expect(body.missing.sort()).toEqual(['ai', 'batch', 'history', 'processing', 'prompts', 'usage', 'webdav'])
  })

  it('写入后 rev 自增，读取按节返回', async () => {
    const first = await call(stateHandler, '/api/state/processing', env, {
      method: 'PUT',
      cookie,
      body: { data: { processingOptions: { chapterConcurrency: 5 } } },
    })
    expect(first.status).toBe(200)
    const { rev } = await first.json()
    expect(rev).toBe(1)

    const second = await call(stateHandler, '/api/state/processing', env, {
      method: 'PUT',
      cookie,
      headers: { 'If-Match': '1' },
      body: { data: { processingOptions: { chapterConcurrency: 7 } } },
    })
    expect((await second.json()).rev).toBe(2)

    const read = await call(stateHandler, '/api/state/processing', env, { cookie })
    const body = await read.json()
    expect(body.value.rev).toBe(2)
    expect(body.value.data.processingOptions.chapterConcurrency).toBe(7)
  })

  it('基于过期 rev 写入返回 409 + 最新值', async () => {
    await call(stateHandler, '/api/state/processing', env, {
      method: 'PUT',
      cookie,
      body: { data: { v: 1 } },
    })
    await call(stateHandler, '/api/state/processing', env, {
      method: 'PUT',
      cookie,
      headers: { 'If-Match': '1' },
      body: { data: { v: 2 } },
    })

    const stale = await call(stateHandler, '/api/state/processing', env, {
      method: 'PUT',
      cookie,
      headers: { 'If-Match': '1' },
      body: { data: { v: 99 } },
    })
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body.error).toBe('conflict')
    expect(body.rev).toBe(2)
    expect(body.data).toEqual({ v: 2 })
  })

  it('未知分区返回 404', async () => {
    const res = await call(stateHandler, '/api/state/nope', env, {
      method: 'PUT',
      cookie,
      body: { data: {} },
    })
    expect(res.status).toBe(404)
  })

  it('非法 JSON 返回 400', async () => {
    const res = await call(stateHandler, '/api/state/ai', env, {
      method: 'PUT',
      cookie,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})

describe('秘密字段脱敏与合并', () => {
  it('maskSecrets 把 apiKey / password 替换为 hasSecret', () => {
    const masked = maskSecrets({
      providers: [{ id: 'p1', apiKey: 'sk-real', models: [] }],
      webdav: { username: 'u', password: 'pw' },
    })
    expect(masked.providers[0].apiKey).toEqual({ hasSecret: true })
    expect(masked.webdav.password).toEqual({ hasSecret: true })
    expect(JSON.stringify(masked)).not.toContain('sk-real')
    expect(JSON.stringify(masked)).not.toContain('"pw"')
  })

  it('提交 hasSecret 引用时保留服务端原密钥', () => {
    const existing = { providers: [{ id: 'p1', apiKey: 'sk-real', name: 'old' }] }
    const merged = mergeSecrets({ providers: [{ id: 'p1', apiKey: { hasSecret: true }, name: 'new' }] }, existing)
    expect(merged.providers[0].apiKey).toBe('sk-real')
    expect(merged.providers[0].name).toBe('new')
  })

  it('提交明文覆盖密钥，提交 null 清除密钥', () => {
    const existing = { providers: [{ id: 'p1', apiKey: 'sk-real' }] }
    expect(mergeSecrets({ providers: [{ id: 'p1', apiKey: 'sk-new' }] }, existing).providers[0].apiKey).toBe('sk-new')
    expect(mergeSecrets({ providers: [{ id: 'p1', apiKey: null }] }, existing).providers[0].apiKey).toBeUndefined()
  })

  it('服务商顺序变化时按 id 对齐，不会把密钥配错对象', () => {
    const existing = {
      providers: [
        { id: 'a', apiKey: 'key-a' },
        { id: 'b', apiKey: 'key-b' },
      ],
    }
    const merged = mergeSecrets(
      { providers: [{ id: 'b', apiKey: { hasSecret: true } }, { id: 'a', apiKey: { hasSecret: true } }] },
      existing
    )
    expect(merged.providers.find((p: { id: string }) => p.id === 'a').apiKey).toBe('key-a')
    expect(merged.providers.find((p: { id: string }) => p.id === 'b').apiKey).toBe('key-b')
  })

  it('部分更新不会删掉未提交的密钥字段', () => {
    const existing = { providers: [{ id: 'p1', apiKey: 'sk-real' }], defaultTemperature: 0.7 }
    const merged = mergeSecrets({ providers: [{ id: 'p1', models: [] }], defaultTemperature: 0.5 }, existing)
    expect(merged.providers[0].apiKey).toBe('sk-real')
    expect(merged.defaultTemperature).toBe(0.5)
  })

  it('显式 null 能真正清除密钥（字段缺席才是「保留原值」）', async () => {
    const env = createEnv()
    const cookie = await tokenFor(env)
    const put = (data: unknown, rev: string) =>
      call(stateHandler, '/api/state/ai', env, {
        method: 'PUT',
        cookie,
        headers: { 'If-Match': rev },
        body: { data },
      })

    const first = await put({ providers: [{ id: 'p1', apiKey: 'sk-real' }] }, '0')
    expect((await first.json()).rev).toBe(1)

    // 只改名字：密钥保留
    await put({ providers: [{ id: 'p1', apiKey: { hasSecret: true }, name: 'renamed' }] }, '1')
    let stored = await (await call(stateHandler, '/api/state/ai', env, { cookie })).json()
    expect(stored.value.data.providers[0].apiKey).toEqual({ hasSecret: true })

    // 显式 null：真的清掉
    await put({ providers: [{ id: 'p1', apiKey: null }] }, '2')
    stored = await (await call(stateHandler, '/api/state/ai', env, { cookie })).json()
    expect(stored.value.data.providers[0].apiKey).toBeUndefined()
  })

  it('通过 HTTP 写入时密钥不出现在响应里', async () => {
    const env = createEnv()
    const cookie = await tokenFor(env)
    await call(stateHandler, '/api/state/ai', env, {
      method: 'PUT',
      cookie,
      body: { data: { providers: [{ id: 'p1', apiKey: 'sk-real' }] } },
    })
    const read = await call(stateHandler, '/api/state', env, { cookie })
    const text = await read.text()
    expect(text).not.toContain('sk-real')
    expect(JSON.parse(text).sections.ai.data.providers[0].apiKey).toEqual({ hasSecret: true })
  })
})

describe('追加型数据', () => {
  let env: ReturnType<typeof createEnv>
  let cookie: string

  beforeEach(async () => {
    env = createEnv()
    cookie = await tokenFor(env)
  })

  it('两台客户端各追加一条历史，都不丢', async () => {
    await call(stateHandler, '/api/state/history/append', env, {
      method: 'POST',
      cookie,
      body: { patch: { records: [{ fileName: 'a.epub', bookTitle: 'A' }] } },
    })
    await call(stateHandler, '/api/state/history/append', env, {
      method: 'POST',
      cookie,
      body: { patch: { records: [{ fileName: 'b.epub', bookTitle: 'B' }] } },
    })
    const res = await call(stateHandler, '/api/state/history', env, { cookie })
    const body = await res.json()
    expect(body.value.data.records.map((r: { fileName: string }) => r.fileName).sort()).toEqual(['a.epub', 'b.epub'])
  })

  it('历史按 fileName 去重，最新在前', async () => {
    for (const title of ['v1', 'v2']) {
      await call(stateHandler, '/api/state/history/append', env, {
        method: 'POST',
        cookie,
        body: { patch: { records: [{ fileName: 'same.epub', bookTitle: title }] } },
      })
    }
    const body = await (await call(stateHandler, '/api/state/history', env, { cookie })).json()
    expect(body.value.data.records).toHaveLength(1)
    expect(body.value.data.records[0].bookTitle).toBe('v2')
  })

  it('用量累加', async () => {
    const append = (patch: unknown) =>
      call(stateHandler, '/api/state/usage/append', env, { method: 'POST', cookie, body: { patch } })

    await append({ tokenUsage: 100, totalCostUSD: 0.1, byModel: { 'gpt-x': { tokens: 100, costUSD: 0.1 } } })
    await append({ tokenUsage: 50, totalCostUSD: 0.05, byModel: { 'gpt-x': { tokens: 50, costUSD: 0.05 } } })

    const body = await (await call(stateHandler, '/api/state/usage', env, { cookie })).json()
    expect(body.value.data.tokenUsage).toBe(150)
    expect(body.value.data.totalCostUSD).toBeCloseTo(0.15)
    expect(body.value.data.byModel['gpt-x'].tokens).toBe(150)
  })

  it('不支持追加的分区返回 400', async () => {
    const res = await call(stateHandler, '/api/state/ai/append', env, {
      method: 'POST',
      cookie,
      body: { patch: {} },
    })
    expect(res.status).toBe(400)
  })
})

describe('KV 未绑定时明确报错', () => {
  it('返回 500 kv_not_configured 而不是静默失败', async () => {
    const env = { } // 没有 FASTREADER_KV
    const res = await call(stateHandler, '/api/state', env, { cookie: await tokenFor({ ...createEnv(), ...env }) })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'kv_not_configured' })
  })
})
