import { isValidUpstreamBase } from '../../../src/services/webdavProxyUtils'

const ALLOWED_ORIGINS = [
  'https://fast-read.pages.dev',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'null'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'OPTIONS, PROPFIND, GET, PUT, POST, DELETE, MKCOL, MOVE, COPY, HEAD',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match, Range, X-Requested-With',
    'Access-Control-Max-Age': '86400'
  }
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin)
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
  const { request } = context
  const origin = request.headers.get('Origin') || ''
  const cors = corsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (!isAllowedMethod(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  if (!isAllowedOrigin(origin)) {
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

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.body,
    redirect: 'manual'
  })

  let response = await fetch(upstreamRequest)

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location) {
      const retryRequest = new Request(location, {
        method: request.method,
        headers: upstreamHeaders,
        body: request.body,
        redirect: 'manual'
      })
      response = await fetch(retryRequest)
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
