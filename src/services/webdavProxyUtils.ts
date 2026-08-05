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
 * 是否为禁止作为 WebDAV 上游的主机名（防 SSRF：本机 / 私网 / 链路本地）
 */
export function isBlockedUpstreamHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true

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

  // IPv6 本地与 ULA
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true

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
