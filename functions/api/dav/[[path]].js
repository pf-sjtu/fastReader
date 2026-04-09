import { isValidUpstreamBase } from '../../../src/services/webdavProxyUtils'

// 从环境变量读取白名单，支持逗号分隔的字符串
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
  
  return [...new Set(env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean))]
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match, Range, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  }
}

function isAllowedOrigin(origin, requestOrigin, allowedOrigins) {
  const normalizedAllowed = allowedOrigins.map(normalizeDomain)
  const normalizedOrigin = origin ? normalizeDomain(origin) : ''
  const normalizedRequestOrigin = requestOrigin ? normalizeDomain(requestOrigin) : ''

  if (normalizedOrigin && normalizedAllowed.includes(normalizedOrigin)) {
    return true
  }
  return normalizedAllowed.includes(normalizedRequestOrigin)
}

function isAllowedMethod(method) {
  return ['OPTIONS', 'PROPFIND', 'GET', 'PUT', 'POST', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'HEAD'].includes(method)
}

function resolveUpstreamUrl(baseUrl, path) {
  const trimmedPath = path ? path.replace(/^\//, '') : ''
  return new URL(trimmedPath, baseUrl).toString()
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

  const upstreamUrl = resolveUpstreamUrl(base, path)
  const upstreamHeaders = filterRequestHeaders(request.headers)
  upstreamHeaders.delete('X-WebDAV-Base')
  upstreamHeaders.delete('X-WebDAV-Path')

  const bodyBuffer = request.body ? await request.arrayBuffer() : null
  const buildRequest = (url) => new Request(url, {
    method: request.method,
    headers: upstreamHeaders,
    body: bodyBuffer,
    redirect: 'manual'
  })

  let response = await fetch(buildRequest(upstreamUrl))

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location) {
      const resolvedUrl = new URL(location, upstreamUrl).toString()
      response = await fetch(buildRequest(resolvedUrl))
    }
  }

  const responseHeaders = new Headers(response.headers)
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
