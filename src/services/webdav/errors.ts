import type { DavExistsStatus } from './types'

/** 5xx / 429 / 网络错误的最大尝试次数（含首次） */
export const EXISTS_MAX_ATTEMPTS = 3
/** 重试退避基数（毫秒），第 n 次重试等待 base * 2^(n-1) */
export const EXISTS_RETRY_BASE_MS = 300

/** 代理自身错误响应头（functions/api/dav 设置），与上游同码的错误靠它区分 */
export const PROXY_ERROR_HEADER = 'X-Proxy-Error'

/** 从 webdav 库错误（error.status / error.response.status）上取 HTTP 状态码；网络错误返回 undefined */
export function getDavErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof e.status === 'number') return e.status
  if (typeof e.response?.status === 'number') return e.response.status
  return undefined
}

/** 代理自身错误 → 用户可读原因（按状态码；仅在已确认带 X-Proxy-Error 时使用） */
export function describeProxyError(status: number | undefined): string {
  switch (status) {
    case 403:
      return '代理拒绝：Origin 不在白名单'
    case 400:
      return '代理拒绝：上游地址或路径非法'
    case 405:
      return '代理拒绝：请求方法不被支持'
    case 413:
      return '代理拒绝：请求体过大'
    case 502:
      return '代理无法连接上游 WebDAV 服务器'
    default:
      return `代理错误 (HTTP ${status ?? '未知'})`
  }
}

/** Response 是否由代理自身产生的错误 */
export function isProxyErrorResponse(res: { headers: { get(name: string): string | null } }): boolean {
  return res.headers.get(PROXY_ERROR_HEADER) === '1'
}

/** 从 webdav 库错误的 response 上识别代理自身错误，返回原因；否则 undefined */
export function getProxyErrorReason(error: unknown): string | undefined {
  const res = (error as { response?: { headers?: { get?: (n: string) => string | null } } } | null)?.response
  if (!res?.headers?.get || res.headers.get(PROXY_ERROR_HEADER) !== '1') return undefined
  return describeProxyError(getDavErrorStatus(error))
}

/**
 * 按 HTTP 状态分类存在性：2xx(200/207)→exists，404→missing，
 * 5xx / 408 / 429 / 无状态(网络错误)→retry，其余(401/403/400/405/413…)→unknown。
 * proxyError=true 表示该状态由代理自身产生：502（上游暂不可达）可重试，其余一律 unknown，
 * 绝不当作上游的 404/403 处理。
 */
export function classifyExistsStatus(
  status: number | undefined,
  proxyError = false
): DavExistsStatus | 'retry' {
  if (status === undefined) return 'retry'
  if (proxyError) return status === 502 ? 'retry' : 'unknown'
  if (status === 404) return 'missing'
  if (status >= 200 && status < 300) return 'exists'
  if (status >= 500 || status === 408 || status === 429) return 'retry'
  return 'unknown'
}

/** 连接测试错误 → 用户可读信息（先识别代理自身错误，再按 HTTP 状态分类） */
export function describeConnectionError(error: unknown): string {
  const proxyReason = getProxyErrorReason(error)
  if (proxyReason) return proxyReason
  const status = getDavErrorStatus(error)
  switch (status) {
    case 401:
      return '认证失败，请检查用户名和密码'
    case 403:
      return '访问被拒绝，可能是权限问题'
    case 404:
      return '服务器地址不正确'
    case 405:
      return '请求方法不被支持，服务器可能未开启 WebDAV'
  }
  if (typeof status === 'number') {
    return status >= 500 ? `服务器错误 (HTTP ${status})` : `连接失败: HTTP ${status}`
  }
  if (error instanceof TypeError) {
    return '网络连接失败，请检查服务器地址或网络'
  }
  return `连接失败: ${error instanceof Error ? error.message : '未知错误'}`
}
