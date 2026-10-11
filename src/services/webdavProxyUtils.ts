export function normalizeDavPath(inputPath: string): string {
  let normalized = inputPath || '/'

  if (normalized.startsWith('/api/webdav/')) {
    normalized = normalized.substring(11)
  } else if (normalized.startsWith('/webdav/')) {
    normalized = normalized.substring(7)
  } else if (normalized.startsWith('/dav/')) {
    normalized = normalized.substring(4)
  } else if (normalized === '/dav') {
    normalized = '/'
  } else if (normalized.startsWith('/../dav/')) {
    normalized = normalized.substring(8)
  } else if (normalized.startsWith('../dav/')) {
    normalized = normalized.substring(7)
  }

  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  const segments = normalized.split('/').filter((segment) => segment !== '')
  const resolved: string[] = []

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue
    }
    if (segment === '..') {
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }

  const rebuilt = '/' + resolved.join('/')
  return rebuilt === '/' ? '/' : rebuilt
}

export function encodeDavHeaderPath(path: string): string {
  const normalized = normalizeDavPath(path)
  return normalized
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : ''))
    .join('/')
}

export function buildWebdavPath(params: {
  folder?: string
  path?: string
}): string {
  const normalizedFolder = normalizeDavPath(params.folder || '/')
  const normalizedPath = normalizeDavPath(params.path || '/')

  let fullPath: string
  if (normalizedPath === '/') {
    fullPath = normalizedFolder === '/' ? '/' : `${normalizedFolder}/`
  } else if (normalizedFolder === '/') {
    fullPath = normalizedPath
  } else {
    fullPath = `${normalizedFolder}/${normalizedPath.replace(/^\//, '')}`
  }

  if (!fullPath.startsWith('/')) {
    fullPath = '/' + fullPath
  }

  return fullPath
}

export function buildWebdavProxyUrl(params: {
  baseUrl: string
  folder?: string
  path?: string
}): string {
  const fullPath = buildWebdavPath({
    folder: params.folder,
    path: params.path
  })

  return `/api/dav?base=${encodeURIComponent(params.baseUrl)}&path=${encodeURIComponent(fullPath)}`
}

/**
 * 用 WHATWG URL 解析器规范化主机名：十进制/八进制/十六进制/缩写 IPv4 → 点分十进制，
 * IPv6 → 小写压缩形式（含方括号，内嵌 IPv4 转为十六进制）。解析失败返回 null。
 */
function canonicalizeHostname(hostname: string): string | null {
  const bare = (hostname || '').trim().replace(/^\[|\]$/g, '')
  if (!bare) return null
  const candidate = bare.includes(':') ? `[${bare}]` : bare
  try {
    return new URL(`http://${candidate}/`).hostname.replace(/\.$/, '')
  } catch {
    return null
  }
}

/** 展开规范化后的 IPv6（不含方括号）为 8 个 16 位分组 */
function parseIpv6Groups(ip: string): number[] | null {
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail].map((x) => parseInt(x, 16))
  if (groups.length !== 8 || groups.some((n) => Number.isNaN(n))) return null
  return groups
}

function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6Groups(ip)
  if (!g) return true
  // ::/96（含 ::、::1、IPv4 兼容地址）与 ::ffff:0:0/96（IPv4 映射）一律拒绝
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0 || g[5] === 0xffff)) return true
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local（已废弃）
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/**
 * 是否为禁止作为上游的主机名（防 SSRF：本机 / 私网 / 链路本地）。
 * 仅做字面量判断，无法防御解析到私网的公网域名（DNS rebinding / nip.io 类）。
 */
export function isBlockedUpstreamHostname(hostname: string): boolean {
  const canonical = canonicalizeHostname(hostname)
  if (!canonical) return true

  // IPv6 规则只对 IP 字面量生效，避免误伤 fd.example.com 之类域名
  if (canonical.startsWith('[')) {
    return isBlockedIpv6(canonical.slice(1, -1))
  }

  const h = canonical
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.intranet') ||
    h === '0.0.0.0'
  ) {
    return true
  }

  // IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const parts = m.slice(1).map((x) => Number(x))
    if (parts.some((n) => n > 255)) return true
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast / reserved
    return false
  }

  return false
}

export function isValidUpstreamBase(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:') {
      return false
    }
    if (url.username || url.password) {
      return false
    }
    if (isBlockedUpstreamHostname(url.hostname)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

/**
 * 目标 URL 是否落在 base 的作用域内：协议+主机+端口相同、pathname 以 base 的 pathname 开头，
 * 且目标本身仍通过 isValidUpstreamBase（https、无凭据、非私网）。
 */
export function isWithinUpstreamScope(baseUrl: string, targetUrl: string): boolean {
  try {
    const base = new URL(withTrailingSlash(baseUrl))
    const target = new URL(targetUrl)
    return (
      target.protocol === base.protocol &&
      target.host === base.host &&
      target.pathname.startsWith(base.pathname) &&
      isValidUpstreamBase(target.toString())
    )
  } catch {
    return false
  }
}

/**
 * 将客户端提供的 path 拼到 base 下；绝对 URL、协议相对、反斜杠变体、../ 越界等
 * 任何逃出 base 作用域的结果都返回 null（代理据此返回 400）。
 */
export function resolveScopedUpstreamUrl(baseUrl: string, path: string): string | null {
  if (!isValidUpstreamBase(baseUrl)) return null
  try {
    // base 必须带尾斜杠，否则 new URL 会把最后一段路径当文件名替换掉
    const base = withTrailingSlash(baseUrl)
    const trimmedPath = path ? path.replace(/^\//, '') : ''
    const resolved = new URL(trimmedPath, base).toString()
    return isWithinUpstreamScope(base, resolved) ? resolved : null
  } catch {
    return null
  }
}
