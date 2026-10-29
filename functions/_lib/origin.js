// Origin 白名单与 CORS/JSON 响应工具（AI 与 DAV 代理共用，避免两份重复逻辑）

const DEFAULT_ORIGINS = [
  'https://fast-read.pages.dev',
  'https://read-app.navira.blog',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
]

/** 从环境变量读取白名单（逗号分隔，追加到默认值） */
export function getAllowedOrigins(env) {
  const raw = env?.ALLOWED_ORIGINS
  if (!raw || typeof raw !== 'string') return DEFAULT_ORIGINS
  const custom = raw.split(',').map((o) => o.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_ORIGINS, ...custom])]
}

function normalizeDomain(domain) {
  return String(domain || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function corsHeaders(method = 'GET, POST, PUT, OPTIONS') {
  return {
    'Access-Control-Allow-Methods': method,
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Depth, If-Match, If-None-Match, Range, X-Requested-With, X-WebDAV-Base, X-WebDAV-Path, X-Request-Origin, X-AI-Base, X-Provider-Id',
    'Access-Control-Expose-Headers': 'X-Proxy-Error, ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/**
 * Origin 存在时以它为准（X-Request-Origin 可伪造，仅在无 Origin 时回退）
 */
export function isAllowedOrigin(origin, requestOrigin, allowedOrigins) {
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)
  const normalizedOrigin = origin ? normalizeDomain(origin) : ''
  const normalizedRequestOrigin = requestOrigin ? normalizeDomain(requestOrigin) : ''

  if (normalizedOrigin) return normalizedAllowed.includes(normalizedOrigin)
  if (normalizedRequestOrigin) return normalizedAllowed.includes(normalizedRequestOrigin)
  return false
}

/** 同源请求（浏览器直接访问本站页面）视为可信，不需要 Origin 白名单 */
export function isSameOriginRequest(request, origin) {
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

/** 生成带 CORS 的响应头（允许来源或同源回显） */
export function withCors(headers = {}, origin, requestOrigin, allowedOrigins, methods) {
  const result = { ...corsHeaders(methods), ...headers }
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)
  const candidate = origin || requestOrigin
  if (candidate && normalizedAllowed.includes(normalizeDomain(candidate))) {
    result['Access-Control-Allow-Origin'] = candidate
  } else if (origin) {
    result['Access-Control-Allow-Origin'] = 'null'
  }
  return result
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...headers },
  })
}
