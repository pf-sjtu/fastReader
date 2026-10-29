// AI 同源代理：上游 base 与凭据一律取自服务端共享配置（按 X-Provider-Id 定位），
// 不接受客户端指定的任意 base，也不接受客户端自带的鉴权头。
import {
  isValidUpstreamBase,
  resolveScopedUpstreamUrl,
} from '../../../src/services/webdavProxyUtils'
import {
  getAllowedOrigins,
  isAllowedOrigin,
  isSameOriginRequest,
  corsHeaders,
  withCors,
} from '../../_lib/origin.js'
import { authHeadersForProtocol, resolveProvider } from '../../_lib/upstream.js'

const ALLOWED_METHODS = ['OPTIONS', 'POST', 'GET']

// 客户端自带、不允许转发的头（含鉴权头：必须由服务端注入）
const DROP_REQUEST_HEADERS = new Set([
  'origin',
  'referer',
  'host',
  'x-request-origin',
  'x-ai-base',
  'x-provider-id',
  'authorization',
  'x-goog-api-key',
  'x-api-key',
  'anthropic-version',
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

// 只回传客户端真正需要的头：上游的 set-cookie / location / 内部头一律不外泄
const RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'cache-control',
  'retry-after',
  'x-request-id',
  'openai-processing-ms',
  'openai-version',
]

function filterResponseHeaders(headers) {
  const out = new Headers()
  const encoding = (headers.get('content-encoding') || '').trim().toLowerCase()
  const bodyTransformed = encoding !== '' && encoding !== 'identity'
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!RESPONSE_HEADER_ALLOWLIST.includes(lower)) return
    // fetch 已解码正文，长度头是压缩后的 → 保留会截断
    if (lower === 'content-length' && bodyTransformed) return
    // 限流相关头统一透传（x-ratelimit-* 不在上面列表里，单独放行）
    out.set(key, value)
  })
  headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-ratelimit-')) out.set(key, value)
  })
  return out
}

function errorResponse(message, status, cors, code) {
  const headers = { ...cors }
  if (code) headers['X-Proxy-Error'] = '1'
  return new Response(code ? JSON.stringify({ error: code, message }) : message, {
    status,
    headers: { 'Content-Type': code ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8', ...headers },
  })
}

export async function onRequest(context) {
  const { request, env } = context
  const origin = request.headers.get('Origin') || ''
  const requestOrigin = request.headers.get('X-Request-Origin') || ''
  const allowedOrigins = getAllowedOrigins(env)
  const cors = withCors({}, origin, requestOrigin, allowedOrigins)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders('OPTIONS, POST, GET') })
  }

  if (!ALLOWED_METHODS.includes(request.method)) {
    return errorResponse('Method not allowed', 405, cors)
  }

  if (origin && !isAllowedOrigin(origin, requestOrigin, allowedOrigins) && !isSameOriginRequest(request, origin)) {
    return errorResponse('Origin not allowed', 403, cors)
  }

  const url = new URL(request.url)
  const providerId = request.headers.get('X-Provider-Id') || ''
  const path = url.searchParams.get('path') || ''

  let provider
  try {
    provider = await resolveProvider(env, providerId)
  } catch (error) {
    if (error?.code === 'kv_missing') return errorResponse('KV not configured', 500, cors, 'kv_not_configured')
    throw error
  }

  if (!provider) {
    return errorResponse('Unknown provider', 400, cors, 'unknown_provider')
  }
  if (!isValidUpstreamBase(provider.baseUrl)) {
    return errorResponse('Invalid upstream base URL', 400, cors, 'invalid_upstream_base')
  }

  const upstreamUrl = resolveScopedUpstreamUrl(provider.baseUrl, path)
  if (!upstreamUrl) {
    return errorResponse('Invalid upstream path', 400, cors, 'invalid_upstream_path')
  }

  const upstreamHeaders = filterRequestHeaders(request.headers)
  for (const [key, value] of Object.entries(authHeadersForProtocol(provider.type, provider.apiKey))) {
    upstreamHeaders.set(key, value)
  }

  const bodyBuffer = request.body ? await request.arrayBuffer() : null
  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: bodyBuffer,
    redirect: 'manual',
  })

  let response
  try {
    response = await fetch(upstreamRequest)
  } catch {
    return errorResponse('Upstream unreachable', 502, cors, 'upstream_unreachable')
  }

  const responseHeaders = filterResponseHeaders(response.headers)
  Object.entries(cors).forEach(([key, value]) => responseHeaders.set(key, value))

  return new Response(response.body, { status: response.status, headers: responseHeaders })
}
