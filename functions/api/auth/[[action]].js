// /api/auth/login | /api/auth/logout | /api/auth/me
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getPassword,
  isAuthenticated,
  isLocalRequest,
  isPasswordConfigured,
  passwordMatches,
} from '../../_lib/session.js'
import { getAllowedOrigins, isAllowedOrigin, isSameOriginRequest, corsHeaders } from '../../_lib/origin.js'

// 登录失败限速：仅失败时写 KV（免费额度下 1000 写/天，不能每次请求都写）
const FAIL_LIMIT = 10
const FAIL_WINDOW_SECONDS = 600
const failKey = (ip) => `auth:fail:${ip}`

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

function actionOf(url) {
  const rest = url.pathname.replace(/^\/api\/auth\/?/, '').replace(/\/+$/, '')
  return rest.split('/')[0] || ''
}

// KV 是最终一致的（同 key 1 写/秒），并发爆破能全部读到 0 → 必须先用 isolate 内内存计数兜住
const memoryFails = new Map()

function readMemoryFails(key) {
  const entry = memoryFails.get(key)
  if (!entry) return 0
  if (entry.resetAt <= Date.now()) {
    memoryFails.delete(key)
    return 0
  }
  return entry.count
}

function bumpMemoryFails(key) {
  const now = Date.now()
  const entry = memoryFails.get(key)
  if (!entry || entry.resetAt <= now) {
    memoryFails.set(key, { count: 1, resetAt: now + FAIL_WINDOW_SECONDS * 1000 })
    return 1
  }
  entry.count += 1
  return entry.count
}

/** 测试用：清空 isolate 内的登录失败计数 */
export function __resetRateLimit() {
  memoryFails.clear()
}

async function readFailCount(env, key) {
  const memory = readMemoryFails(key)
  try {
    const raw = await env?.FASTREADER_KV?.get?.(key)
    return Math.max(memory, Number(raw) || 0)
  } catch {
    return memory
  }
}

async function bumpFailCount(env, key) {
  const memory = bumpMemoryFails(key)
  try {
    if (!env?.FASTREADER_KV?.put) return
    await env.FASTREADER_KV.put(key, String(memory), { expirationTtl: FAIL_WINDOW_SECONDS })
  } catch {
    // 限速是尽力而为：KV 不可用不应阻断登录
  }
}

async function clearFailCount(env, key) {
  memoryFails.delete(key)
  try {
    await env?.FASTREADER_KV?.delete?.(key)
  } catch {
    // ignore
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const action = actionOf(url)
  const origin = request.headers.get('Origin') || ''
  const requestOrigin = request.headers.get('X-Request-Origin') || ''
  const allowedOrigins = getAllowedOrigins(env)

  const cors = {}
  if (origin) {
    if (!isAllowedOrigin(origin, requestOrigin, allowedOrigins)) {
      return json({ error: 'origin_not_allowed' }, 403)
    }
    cors['Access-Control-Allow-Origin'] = origin
    cors['Vary'] = 'Origin'
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...corsHeaders('OPTIONS, POST, GET'), ...cors } })
  }

  if (action === 'me') {
    const authed = await isAuthenticated(request, env)
    return authed ? json({ authed: true }, 200, cors) : json({ authed: false, error: 'unauthorized' }, 401, cors)
  }

  if (action === 'logout') {
    return json({ ok: true }, 200, { ...cors, 'Set-Cookie': clearSessionCookie() })
  }

  if (action !== 'login') {
    return json({ error: 'not_found' }, 404, cors)
  }

  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, cors)
  }

  // 没配 APP_PASSWORD 就只允许本机用缺省密码；否则任意公网部署都会变成「密码 123456a」
  if (!isPasswordConfigured(env) && !isLocalRequest(request)) {
    return json({ error: 'password_not_configured' }, 503, cors)
  }

  // 跨源请求必须是白名单来源；同源请求天然可信
  if (origin && !isAllowedOrigin(origin, requestOrigin, allowedOrigins) && !isSameOriginRequest(request, origin)) {
    return json({ error: 'origin_not_allowed' }, 403, cors)
  }

  const ip = clientIp(request)
  const key = failKey(ip)
  const fails = await readFailCount(env, key)
  if (fails >= FAIL_LIMIT) {
    return json({ error: 'too_many_attempts' }, 429, { ...cors, 'Retry-After': String(FAIL_WINDOW_SECONDS) })
  }

  let password = ''
  try {
    const body = await request.json()
    password = typeof body?.password === 'string' ? body.password : ''
  } catch {
    password = ''
  }

  if (!(await passwordMatches(password, getPassword(env)))) {
    await bumpFailCount(env, key)
    return json({ error: 'invalid_password' }, 401, cors)
  }

  await clearFailCount(env, key)
  const token = await createSessionToken(env)
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': buildSessionCookie(token) })
}
