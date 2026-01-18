export function normalizeDavPath(inputPath: string): string {
  let normalized = inputPath || '/'

  if (normalized.startsWith('/api/webdav/')) {
    normalized = normalized.substring(11)
  } else if (normalized.startsWith('/webdav/')) {
    normalized = normalized.substring(7)
  } else if (normalized.startsWith('/../dav/')) {
    normalized = normalized.substring(8)
  } else if (normalized.startsWith('../dav/')) {
    normalized = normalized.substring(7)
  }

  if (normalized === '') {
    return '/'
  }

  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  return normalized
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

export function isValidUpstreamBase(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:') {
      return false
    }
    if (url.username || url.password) {
      return false
    }
    return true
  } catch {
    return false
  }
}
