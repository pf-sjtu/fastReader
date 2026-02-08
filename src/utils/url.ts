/**
 * URL处理工具函数
 */

/**
 * 构建AI代理目标URL
 * 解析API端点路径
 */
export function buildAiProxyTarget(url: string): { base: string; path: string } {
  const apiUrl = new URL(url)
  const pathname = apiUrl.pathname
  const match = pathname.match(/^(.*)\/(chat\/completions|api\/chat)$/)

  if (match) {
    const basePath = match[1] || ''
    const endpoint = match[2]
    return {
      base: apiUrl.origin + basePath,
      path: endpoint
    }
  }

  return {
    base: apiUrl.origin + pathname.replace(/\/$/, ''),
    path: pathname.replace(/^\//, '')
  }
}

/**
 * 构建WebDAV代理URL
 */
export function buildWebDavProxyUrl(
  baseUrl: string,
  path: string,
  origin: string
): string {
  const proxyUrl = new URL('/api/dav', origin)
  proxyUrl.searchParams.set('path', encodeURIComponent(path))
  proxyUrl.searchParams.set('base', encodeURIComponent(baseUrl))
  return proxyUrl.toString()
}

/**
 * 构建AI代理URL
 */
export function buildAiProxyUrl(
  targetUrl: string,
  origin: string
): string {
  const target = buildAiProxyTarget(targetUrl)
  const proxyUrl = new URL('/api/ai', origin)
  proxyUrl.searchParams.set('path', target.path)
  return proxyUrl.toString()
}

/**
 * 验证URL是否有效
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 安全地合并URL
 */
export function joinUrl(base: string, path: string): string {
  const baseUrl = base.endsWith('/') ? base : base + '/'
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return baseUrl + cleanPath
}

/**
 * 获取URL路径的最后一段作为文件名
 */
export function getUrlPathFilename(url: string): string {
  try {
    const urlObj = new URL(url)
    const segments = urlObj.pathname.split('/').filter(Boolean)
    return segments[segments.length - 1] || ''
  } catch {
    return ''
  }
}

/**
 * 检查URL是否是本地地址
 */
export function isLocalUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return (
      urlObj.hostname === 'localhost' ||
      urlObj.hostname === '127.0.0.1' ||
      urlObj.hostname.startsWith('192.168.') ||
      urlObj.hostname.startsWith('10.')
    )
  } catch {
    return false
  }
}
