/**
 * AI Provider 共享工具函数（仅浏览器：项目约束 Browser-only，不含 Node 代理分支）
 */

import type { RateLimitError } from './types'
import {
  backoffDelay,
  classifyError,
  parseRetryAfterBody,
  RETRY_MAX_DELAY_MS,
} from './retry'

// 检查是否在浏览器环境
export const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'

// 等待指定时间
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 代理请求所需的上下文：服务商 id 与它的 baseUrl（服务端据此注入 base 与凭据） */
export interface ProxyTargetContext {
  providerId?: string
  /** 服务商 baseUrl；用于把完整请求 URL 折算成相对 base 的端点路径 */
  apiBase?: string
}

/**
 * 把完整请求 URL 折算成「相对服务商 baseUrl 的端点路径」。
 *
 * 例：apiBase=https://x/v1，url=https://x/v1/chat/completions → chat/completions
 *     apiBase=https://y/v1beta，url=https://y/v1beta/models/m:generateContent → models/m:generateContent
 */
export function toEndpointPath(url: string, apiBase: string | undefined): string {
  const normalizedBase = (apiBase || '').replace(/\/+$/, '')
  if (normalizedBase && url.startsWith(normalizedBase)) {
    return url.slice(normalizedBase.length).replace(/^\/+/, '')
  }
  // 兜底：按 origin 折算（服务端仍会校验最终 URL 落在 base 内）
  try {
    return new URL(url).pathname.replace(/^\/+/, '')
  } catch {
    return url.replace(/^\/+/, '')
  }
}

/**
 * 浏览器内走同源 /api/ai 代理（Cloudflare Pages Function），规避 CORS。
 *
 * 上游 base 与凭据都在服务端：这里只传服务商 id 与端点路径，
 * 客户端无法指定任意上游地址，也无需接触 API Key。
 */
export async function proxyFetch(
  url: string,
  options: RequestInit,
  context: ProxyTargetContext = {}
): Promise<Response> {
  if (!isBrowser) {
    return fetch(url, options)
  }

  const origin = window.location.origin
  const proxyUrl = new URL('/api/ai', origin)
  proxyUrl.searchParams.set('path', toEndpointPath(url, context.apiBase))

  const headers = new Headers(options.headers)
  if (context.providerId) headers.set('X-Provider-Id', context.providerId)
  headers.set('X-Request-Origin', origin)

  return fetch(proxyUrl.toString(), {
    ...options,
    headers,
  })
}

// 识别流量限制错误（上下文超长不算限流）
export function identifyRateLimitError(
  error: Error,
  status?: number,
  errorBody?: string
): RateLimitError | null {
  const probe = { message: error?.message ?? '', status: status ?? (error as { status?: number })?.status }
  if (classifyError(probe) !== 'rateLimit') return null

  const rateLimitError = new Error(`API流量限制: ${probe.message}`) as RateLimitError
  rateLimitError.isRateLimit = true
  rateLimitError.status = 429
  rateLimitError.code = 'rate_limit_exceeded'
  const retryAfterMs = parseRetryAfterBody(errorBody)
  if (retryAfterMs !== undefined) {
    rateLimitError.retryAfter = retryAfterMs / 1000
  }
  return rateLimitError
}

// 计算重试延迟（指数退避 + 抖动）
export function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number = RETRY_MAX_DELAY_MS
): number {
  return Math.min(backoffDelay(attempt, baseDelay), maxDelay)
}
