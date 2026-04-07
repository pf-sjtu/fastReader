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

function corsHeaders(origin, requestOrigin, allowedOrigins) {
  const allowOrigin = origin && allowedOrigins.includes(origin)
    ? origin
    : (allowedOrigins.includes(requestOrigin) ? requestOrigin : 'null')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Origin, X-AI-Base',
    'Access-Control-Max-Age': '86400'
  }
}

function isAllowedOrigin(origin, requestOrigin, allowedOrigins) {
  if (origin && allowedOrigins.includes(origin)) {
    return true
  }
  return allowedOrigins.includes(requestOrigin)
}

function isAllowedMethod(method) {
  return ['OPTIONS', 'POST', 'GET'].includes(method)
}

function isValidUpstreamBase(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function resolveUpstreamUrl(baseUrl, path) {
  const trimmedPath = path ? path.replace(/^\//, '') : ''
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(trimmedPath, normalizedBase).toString()
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

  const upstreamUrl = resolveUpstreamUrl(base, path)
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
  Object.entries(cors).forEach(([key, value]) => {
    responseHeaders.set(key, value)
  })

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  })
}
