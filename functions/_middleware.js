// 全局中间件：/api/*（除 /api/auth/*）必须已登录；其余请求直接放行。
// 同时给所有响应补最小安全头。
import { isAuthenticated } from './_lib/session.js'
import { jsonResponse } from './_lib/origin.js'

const PUBLIC_API_PREFIXES = ['/api/auth/']

function securityHeaders(headers) {
  const next = new Headers(headers)
  if (!next.has('X-Content-Type-Options')) next.set('X-Content-Type-Options', 'nosniff')
  if (!next.has('Referrer-Policy')) next.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return next
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)

  if (!url.pathname.startsWith('/api/')) {
    const response = await next()
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: securityHeaders(response.headers),
    })
  }

  // 预检请求不需要会话：CORS 头由各函数自己给出
  if (request.method === 'OPTIONS') {
    const response = await next()
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: securityHeaders(response.headers),
    })
  }

  if (PUBLIC_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return next()
  }

  const authed = await isAuthenticated(request, env)
  if (!authed) {
    return jsonResponse({ error: 'unauthorized' }, 401, {
      'Cache-Control': 'no-store',
      ...Object.fromEntries(securityHeaders(new Headers()).entries()),
    })
  }

  const response = await next()
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: securityHeaders(response.headers),
  })
}
