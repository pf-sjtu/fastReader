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

/**
 * 构建 AI 代理目标：base 为 origin（chat 端点保留其前缀路径），path 为去前导 `/` 的端点路径。
 * 例：https://x/v1/chat/completions → base=https://x/v1, path=chat/completions；
 *     https://x/v1/models → base=https://x, path=v1/models
 */
export function buildAiProxyTarget(url: string): { base: string; path: string } {
  const apiUrl = new URL(url)
  const pathname = apiUrl.pathname.replace(/\/+$/, '')
  const match = pathname.match(/^(.*)\/(chat\/completions|api\/chat)$/)

  if (match) {
    return {
      base: apiUrl.origin + (match[1] || ''),
      path: match[2],
    }
  }

  return {
    base: apiUrl.origin,
    path: pathname.replace(/^\/+/, ''),
  }
}

/** 浏览器内走同源 /api/ai 代理（Cloudflare Pages Function），规避 CORS */
export async function proxyFetch(url: string, options: RequestInit): Promise<Response> {
  if (!isBrowser) {
    return fetch(url, options)
  }

  const origin = window.location.origin
  const target = buildAiProxyTarget(url)
  const proxyUrlObj = new URL('/api/ai', origin)
  proxyUrlObj.searchParams.set('path', target.path)

  const headers = new Headers(options.headers)
  headers.set('X-AI-Base', target.base)
  headers.set('X-Request-Origin', origin)

  return fetch(proxyUrlObj.toString(), {
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
