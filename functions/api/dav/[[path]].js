// WebDAV 同源代理：上游 base 与凭据一律取自服务端共享配置（state:webdav），
// 客户端只提供路径；自带的 Authorization / X-WebDAV-Base 一律丢弃。
import {
  isValidUpstreamBase,
  isWithinUpstreamScope,
  resolveScopedUpstreamUrl,
} from '../../../src/services/webdavProxyUtils'
import {
  getAllowedOrigins,
  isAllowedOrigin,
  isSameOriginRequest,
  corsHeaders,
  withCors,
} from '../../_lib/origin.js'
import { resolveWebdav } from '../../_lib/upstream.js'

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
  'accept-ranges',
]

const ALLOWED_METHODS = ['OPTIONS', 'PROPFIND', 'GET', 'PUT', 'POST', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'HEAD']

// 客户端自带、不允许转发的头（鉴权与上游地址必须由服务端决定）
const DROP_REQUEST_HEADERS = new Set([
  'origin',
  'referer',
  'host',
  'x-request-origin',
  'x-webdav-base',
  'x-webdav-path',
  'authorization',
  'cookie',
  'content-length',
])

function filterRequestHeaders(headers) {
  const upstreamHeaders = new Headers()
  headers.forEach((value, key) => {
    if (DROP_REQUEST_HEADERS.has(key.toLowerCase())) return
    upstreamHeaders.set(key, value)
  })
  return upstreamHeaders
}

function filterResponseHeaders(headers, base, usedUrl) {
  // 上游做了内容编码（gzip 等）时，fetch 已把正文解码，content-length 仍是压缩后的长度；
  // 透传会让客户端按错误长度截断正文（PROPFIND 列表解析为空），此时必须丢弃该头
  const encoding = (headers.get('content-encoding') || '').trim().toLowerCase()
  const bodyTransformed = encoding !== '' && encoding !== 'identity'

  const out = new Headers()
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!RESPONSE_HEADER_ALLOWLIST.includes(lower)) return
    if (lower === 'content-length' && bodyTransformed) return
    out.set(key, value)
  })

  const location = headers.get('location')
  if (location && base) {
    try {
      const target = new URL(location, usedUrl).toString()
      if (isWithinUpstreamScope(base, target)) out.set('location', target)
      else out.delete('location')
    } catch {
      out.delete('location')
    }
  }
  return out
}

function proxyError(message, status, cors) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'X-Proxy-Error': '1', ...cors },
  })
}

function resolveRedirectTarget(base, location, currentUrl) {
  try {
    const target = new URL(location, currentUrl).toString()
    return isWithinUpstreamScope(base, target) ? target : null
  } catch {
    return null
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const origin = request.headers.get('Origin') || ''
  const requestOrigin = request.headers.get('X-Request-Origin') || ''
  const allowedOrigins = getAllowedOrigins(env)
  const cors = withCors({}, origin, requestOrigin, allowedOrigins)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders('OPTIONS, PROPFIND, GET, PUT, POST, DELETE, MKCOL, MOVE, COPY, HEAD') })
  }

  if (!ALLOWED_METHODS.includes(request.method)) {
    return proxyError('Method not allowed', 405, cors)
  }

  if (origin && !isAllowedOrigin(origin, requestOrigin, allowedOrigins) && !isSameOriginRequest(request, origin)) {
    return proxyError('Origin not allowed', 403, cors)
  }

  const url = new URL(request.url)
  const headerPath = request.headers.get('X-WebDAV-Path') || ''
  const path = headerPath || url.searchParams.get('path') || '/'

  let dav
  try {
    dav = await resolveWebdav(env)
  } catch (error) {
    if (error?.code === 'kv_missing') return proxyError('KV not configured', 500, cors)
    throw error
  }

  if (!dav.serverUrl) {
    return proxyError('WebDAV is not configured', 400, cors)
  }
  if (!dav.basicAuth) {
    return proxyError('WebDAV credentials are incomplete', 400, cors)
  }
  if (!isValidUpstreamBase(dav.serverUrl)) {
    return proxyError('Invalid upstream base URL', 400, cors)
  }

  const upstreamUrl = resolveScopedUpstreamUrl(dav.serverUrl, path)
  if (!upstreamUrl) {
    return proxyError('Invalid upstream path', 400, cors)
  }

  const upstreamHeaders = filterRequestHeaders(request.headers)
  upstreamHeaders.set('Authorization', dav.basicAuth)

  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return proxyError('Payload too large', 413, cors)
  }

  // 长度已知且在限额内 → 直接流式转发（大文件不必整体读进 128MB 的 Worker 内存）
  // 长度未知（chunked）时才缓冲一次来量实际大小。
  let body = request.body
  let buffered = null
  if (request.body && !declaredLength) {
    const buffer = await request.arrayBuffer()
    if (buffer.byteLength > MAX_BODY_BYTES) return proxyError('Payload too large', 413, cors)
    body = buffer
    buffered = buffer
  }
  void buffered

  const buildRequest = (target) =>
    new Request(target, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual',
    })

  let currentUrl = upstreamUrl
  let response
  try {
    response = await fetch(buildRequest(currentUrl))
  } catch {
    return proxyError('Upstream unreachable', 502, cors)
  }

  // 只在重定向目标仍处于 base 作用域（同源 + 路径前缀）时跟随一次；跨源不跟随，凭据不外泄
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    const redirectUrl = location ? resolveRedirectTarget(dav.serverUrl, location, currentUrl) : null
    if (redirectUrl) {
      currentUrl = redirectUrl
      try {
        response = await fetch(buildRequest(currentUrl))
      } catch {
        return proxyError('Upstream unreachable', 502, cors)
      }
    }
  }

  const responseHeaders = filterResponseHeaders(response.headers, dav.serverUrl, currentUrl)
  Object.entries(cors).forEach(([key, value]) => responseHeaders.set(key, value))
  if (response.status >= 300 && response.status < 400) responseHeaders.delete('location')

  return new Response(response.body, { status: response.status, headers: responseHeaders })
}
