// 与 DAV 代理共用同一套上游校验（https、无凭据、非私网/本机、path 不得逃出 base）。
// AI 服务商由用户自定义，因此不做主机白名单。
import { isValidUpstreamBase, resolveScopedUpstreamUrl } from '../../../src/services/webdavProxyUtils'

// 从环境变量读取白名单，支持逗号分隔的字符串（追加到默认值）
function getAllowedOrigins(env) {
  const defaultOrigins = [
    'https://fast-read.pages.dev',
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
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Origin, X-AI-Base',
    'Access-Control-Max-Age': '86400'
  }
}

function isAllowedOrigin(origin, requestOrigin, allowedOrigins) {
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)
  const normalizedOrigin = origin ? normalizeDomain(origin) : ''
  const normalizedRequestOrigin = requestOrigin ? normalizeDomain(requestOrigin) : ''

  // 与 DAV 代理一致：Origin 存在时以它为准，X-Request-Origin 可伪造，仅在无 Origin 时回退
  if (normalizedOrigin) {
    return normalizedAllowed.includes(normalizedOrigin)
  }
  if (normalizedRequestOrigin) {
    return normalizedAllowed.includes(normalizedRequestOrigin)
  }
  return false
}

function isAllowedMethod(method) {
  return ['OPTIONS', 'POST', 'GET'].includes(method)
}

function filterRequestHeaders(headers) {
  const upstreamHeaders = new Headers()
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (['origin', 'referer', 'host', 'x-request-origin', 'x-ai-base'].includes(lowerKey)) {
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
  const headerBase = request.headers.get('X-AI-Base') || ''
  const base = headerBase || url.searchParams.get('base') || ''
  const path = url.searchParams.get('path') || ''

  if (!isValidUpstreamBase(base)) {
    return new Response('Invalid upstream base URL', { status: 400, headers: cors })
  }

  const upstreamUrl = resolveScopedUpstreamUrl(base, path)
  if (!upstreamUrl) {
    return new Response('Invalid upstream path', { status: 400, headers: cors })
  }
  const upstreamHeaders = filterRequestHeaders(request.headers)

  const bodyBuffer = request.body ? await request.arrayBuffer() : null
  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: bodyBuffer,
    redirect: 'manual'
  })

  const response = await fetch(upstreamRequest)
  const responseHeaders = new Headers(response.headers)
  // 上游 Cookie 不应落到本站源下
  responseHeaders.delete('set-cookie')
  Object.entries(cors).forEach(([key, value]) => {
    responseHeaders.set(key, value)
  })

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  })
}
