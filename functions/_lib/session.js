// 会话 Cookie 的签发与校验
// 密码来自环境变量 APP_PASSWORD（缺省 123456a）；密钥默认由密码派生，可用 SESSION_SECRET 覆盖。
// 会话签名里带密码指纹：改 APP_PASSWORD 会让此前签发的所有会话立即失效。

export const SESSION_COOKIE = 'fr_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 天
export const DEFAULT_PASSWORD = '123456a'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function getPassword(env) {
  const value = env?.APP_PASSWORD
  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_PASSWORD
}

/**
 * 部署是否漏配了 APP_PASSWORD。
 *
 * 漏配时回落到缺省密码 123456a → 等于把全部配置、API Key 与 WebDAV 写权限公开。
 * 因此只在「本机/预览」环境允许回落，正式环境由 /api/auth/login 直接 503。
 */
export function isPasswordConfigured(env) {
  return typeof env?.APP_PASSWORD === 'string' && env.APP_PASSWORD.length > 0
}

/** 请求是否来自本机（允许用缺省密码做本地开发） */
export function isLocalRequest(request) {
  try {
    const host = new URL(request.url).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.local')
  } catch {
    return false
  }
}

/** 密码指纹：只用前 16 位十六进制，足够区分密码且不泄漏密码本身 */
export async function passwordFingerprint(env) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`fastreader-pw:${getPassword(env)}`))
  return toHex(new Uint8Array(digest)).slice(0, 16)
}

async function hmacKey(env) {
  const secret =
    typeof env?.SESSION_SECRET === 'string' && env.SESSION_SECRET.length > 0
      ? env.SESSION_SECRET
      : `fastreader-session:${getPassword(env)}`
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

function toHex(bytes) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** base64url（无 padding），浏览器与 Workers 都有 btoa/atob */
function b64urlEncode(text) {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return decoder.decode(bytes)
}

/** 常数时间字符串比较（长度不同直接false，长度相同逐字节异或累积） */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 签发会话 token */
export async function createSessionToken(env, nowMs = Date.now()) {
  const payload = {
    v: 1,
    fp: await passwordFingerprint(env),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + SESSION_MAX_AGE,
  }
  const encoded = b64urlEncode(JSON.stringify(payload))
  const key = await hmacKey(env)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded))
  return `${encoded}.${b64urlEncode(String.fromCharCode(...new Uint8Array(signature)))}`
}

/** 校验会话 token；返回 payload 或 null */
export async function verifySessionToken(env, token, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length === 0) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const encoded = token.slice(0, dot)
  const signaturePart = token.slice(dot + 1)

  let signatureBytes
  try {
    const binary = b64urlDecode(signaturePart)
    signatureBytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) signatureBytes[i] = binary.charCodeAt(i)
  } catch {
    return null
  }

  const key = await hmacKey(env)
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(encoded))
  } catch {
    return null
  }
  if (!valid) return null

  let payload
  try {
    payload = JSON.parse(b64urlDecode(encoded))
  } catch {
    return null
  }
  if (!payload || payload.v !== 1) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null
  // 密码变了：指纹不再匹配
  if (!constantTimeEqual(String(payload.fp ?? ''), await passwordFingerprint(env))) return null

  return payload
}

/** 从请求读取指定 cookie */
export function readCookie(request, name) {
  const header = request?.headers?.get?.('cookie') || ''
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function buildSessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
}

/** 请求是否已登录 */
export async function isAuthenticated(request, env, nowMs = Date.now()) {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return false
  return (await verifySessionToken(env, token, nowMs)) !== null
}
