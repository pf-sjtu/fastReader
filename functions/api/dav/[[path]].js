import {
  isValidUpstreamBase,
  isWithinUpstreamScope,
  resolveScopedUpstreamUrl
} from '../../../src/services/webdavProxyUtils'

// 请求体上限（字节），超限返回 413，防止 Worker 内存被打满
const MAX_BODY_BYTES = 50 * 1024 * 1024

// 回传给浏览器的上游响应头白名单（location 另行按同源规则处理）
const RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'dav',
  'content-range',
  'accept-ranges'
]

// 从环境变量读取白名单，支持逗号分隔的字符串（追加到默认值）
function getAllowedOrigins(env) {
  const defaultOrigins = [
    'https://fast-read.pages.dev',
    'https://read-app.navira.blog',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]

  if (!env?.ALLOWED_ORIGINS) {
    return defaultOrigins
  }

  const customOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  return [...new Set([...defaultOrigins, ...customOrigins])]
}

// 提取域名的核心部分（去掉协议和尾部斜杠）
function normalizeDomain(domain) {
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

function corsHeaders(origin, requestOrigin, allowedOrigins) {
  const normalizedOrigin = origin ? normalizeDomain(origin) : ''
  const normalizedRequestOrigin = requestOrigin ? normalizeDomain(requestOrigin) : ''
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)

  const allowOrigin = normalizedOrigin && normalizedAllowed.includes(normalizedOrigin)
    ? origin
    : (normalizedAllowed.includes(normalizedRequestOrigin) ? requestOrigin : 'null')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'OPTIONS, PROPFIND, GET, PUT, POST, DELETE, MKCOL, MOVE, COPY, HEAD',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match, Range, X-Requested-With, X-WebDAV-Base, X-WebDAV-Path, X-Request-Origin',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  }
}

function isAllowedOrigin(origin, requestOrigin, allowedOrigins) {
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)
  const normalizedOrigin = origin ? normalizeDomain(origin) : ''
  const normalizedRequestOrigin = requestOrigin ? normalizeDomain(requestOrigin) : ''

  // 优先信任浏览器 Origin；两者同时存在时以 Origin 为准，忽略可伪造的 X-Request-Origin
  if (normalizedOrigin) {
    return normalizedAllowed.includes(normalizedOrigin)
  }
  // 无 Origin（部分同源/非浏览器场景）时才回退 X-Request-Origin 白名单
  if (normalizedRequestOrigin) {
    return normalizedAllowed.includes(normalizedRequestOrigin)
  }
  return false
}

function isAllowedMethod(method) {
  return ['OPTIONS', 'PROPFIND', 'GET', 'PUT', 'POST', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'HEAD'].includes(method)
}

// 解析重定向目标；不在 base 作用域内（跨源/越界/私网）返回 null
function resolveRedirectTarget(base, location, currentUrl) {
  try {
    const target = new URL(location, currentUrl).toString()
    return isWithinUpstreamScope(base, target) ? target : null
  } catch {
    return null
  }
}

function filterResponseHeaders(headers, base, currentUrl) {
  const out = new Headers()
  RESPONSE_HEADER_ALLOWLIST.forEach((key) => {
    const value = headers.get(key)
    if (value !== null) out.set(key, value)
  })
  const location = headers.get('location')
  if (location && resolveRedirectTarget(base, location, currentUrl)) {
    out.set('location', location)
  }
  return out
}

function filterRequestHeaders(headers) {
  const upstreamHeaders = new Headers()
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (['origin', 'referer', 'host', 'x-webdav-base', 'x-webdav-path'].includes(lowerKey)) {
      return
    }
    upstreamHeaders.set(key, value)
  })
  return upstreamHeaders
}

export async function onRequest(context) {
  const { request, env } = context
  const allowedOrigins = getAllowedOrigins(env)
  const origin = request.headers.get('Origin') || ''
  const requestOrigin = request.headers.get('X-Request-Origin') || ''
  const cors = corsHeaders(origin, requestOrigin, allowedOrigins)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (!isAllowedMethod(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  if (!isAllowedOrigin(origin, requestOrigin, allowedOrigins)) {
    return new Response('Origin not allowed', { status: 403, headers: cors })
  }

  const url = new URL(request.url)
  const headerBase = request.headers.get('X-WebDAV-Base') || ''
  const headerPath = request.headers.get('X-WebDAV-Path') || ''
  const base = headerBase || url.searchParams.get('base') || ''
  const path = headerPath || url.searchParams.get('path') || '/'

  if (!isValidUpstreamBase(base)) {
    return new Response('Invalid upstream base URL', { status: 400, headers: cors })
  }

  const upstreamUrl = resolveScopedUpstreamUrl(base, path)
  if (!upstreamUrl) {
    return new Response('Invalid upstream path', { status: 400, headers: cors })
  }
  const upstreamHeaders = filterRequestHeaders(request.headers)
  upstreamHeaders.delete('X-WebDAV-Base')
  upstreamHeaders.delete('X-WebDAV-Path')

  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413, headers: cors })
  }
  const bodyBuffer = request.body ? await request.arrayBuffer() : null
  // 无 Content-Length（chunked）时读完再校验实际大小
  if (bodyBuffer && bodyBuffer.byteLength > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413, headers: cors })
  }
  const buildRequest = (url) => new Request(url, {
    method: request.method,
    headers: upstreamHeaders,
    body: bodyBuffer,
    redirect: 'manual'
  })

  let currentUrl = upstreamUrl
  let response = await fetch(buildRequest(currentUrl))

  // 只在重定向目标仍处于 base 作用域（同源 + 路径前缀）时跟随一次；跨源不跟随，凭据不外泄
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    const redirectUrl = location ? resolveRedirectTarget(base, location, currentUrl) : null
    if (redirectUrl) {
      currentUrl = redirectUrl
      response = await fetch(buildRequest(currentUrl))
    }
  }

  const responseHeaders = filterResponseHeaders(response.headers, base, currentUrl)
  Object.entries(cors).forEach(([key, value]) => {
    responseHeaders.set(key, value)
  })

  if (response.status >= 300 && response.status < 400) {
    responseHeaders.delete('location')
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  })
}
