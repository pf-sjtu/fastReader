/**
 * AI Provider 共享工具函数
 */

import type { RateLimitError } from './types'

// 检查是否在浏览器环境
export const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'

// 等待指定时间
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 动态加载代理相关包
export async function getHttpsProxyAgent(): Promise<new (url: string) => { destroy: () => void } | null> {
  if (isBrowser) {
    return null
  }

  try {
    const httpsProxyAgentModule = await import('https-proxy-agent')
    return httpsProxyAgentModule.HttpsProxyAgent as new (url: string) => { destroy: () => void }
  } catch (error) {
    console.warn('无法加载 https-proxy-agent，代理功能将不可用:', error)
    return null
  }
}

// 构建AI代理目标
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

// 代理fetch函数
export async function proxyFetch(
  url: string,
  options: RequestInit,
  proxyUrl?: string
): Promise<Response> {
  if (isBrowser) {
    const origin = window.location.origin
    const target = buildAiProxyTarget(url)
    const proxyUrlObj = new URL('/api/ai', origin)
    proxyUrlObj.searchParams.set('path', target.path)

    const headers = new Headers(options.headers)
    headers.set('X-AI-Base', target.base)
    headers.set('X-Request-Origin', origin)

    return fetch(proxyUrlObj.toString(), {
      ...options,
      headers
    })
  }

  if (!proxyUrl) {
    return fetch(url, options)
  }

  try {
    const HttpsProxyAgent = await getHttpsProxyAgent()
    if (!HttpsProxyAgent) {
      console.warn('代理模块不可用，使用直接连接')
      return fetch(url, options)
    }

    const agent = new HttpsProxyAgent(proxyUrl)
    const { default: https } = await import('node:https')

    const parsedUrl = new URL(url)

    interface RequestOptions {
      hostname: string
      port: number
      path: string
      method: string
      headers: Record<string, string>
      agent: typeof agent
      timeout: number
    }

    const requestOptions: RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...options.headers as Record<string, string>,
        Host: parsedUrl.hostname,
        'User-Agent': 'ebook-to-mindmap/1.0'
      },
      agent: agent,
      timeout: 30000
    }

    if (options.body) {
      const bodyString =
        typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      requestOptions.headers['Content-Length'] = String(Buffer.byteLength(bodyString))
    }

    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, (res: { statusCode?: number; statusMessage?: string; headers: Record<string, string>; on: (event: string, callback: unknown) => void }) => {
        const chunks: Buffer[] = []

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString()

          const response = new Response(body, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers
          })

          resolve(response)
        })

        res.on('error', (error: Error) => {
          reject(error)
        })
      })

      req.on('error', (error: Error) => {
        reject(new Error(`代理连接失败: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('代理请求超时'))
      })

      if (options.body) {
        const bodyString =
          typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
        req.write(bodyString)
      }

      req.end()
    })
  } catch (error) {
    console.error('代理请求失败:', error)
    throw error
  }
}

// 识别流量限制错误
export function identifyRateLimitError(
  error: Error,
  status?: number,
  errorBody?: string
): RateLimitError | null {
  // 检查HTTP状态码
  if (status === 429) {
    const rateLimitError: RateLimitError = new Error('API流量限制') as RateLimitError
    rateLimitError.isRateLimit = true
    rateLimitError.status = status

    // 尝试从响应体中提取重试时间
    if (errorBody) {
      try {
        const bodyData = JSON.parse(errorBody)
        rateLimitError.retryAfter = bodyData.retry_after || bodyData.retryAfter || 10
        rateLimitError.code = bodyData.code || 'rate_limit_exceeded'
      } catch {
        rateLimitError.retryAfter = 10
        rateLimitError.code = 'rate_limit_exceeded'
      }
    } else {
      rateLimitError.retryAfter = 10
      rateLimitError.code = 'rate_limit_exceeded'
    }

    return rateLimitError
  }

  // 检查错误消息中的流量限制关键词
  const errorMessage = error.message || ''
  const rateLimitKeywords = [
    'token_quota_exceeded',
    'rate_limit_exceeded',
    'too many requests',
    'tokens per minute limit',
    'rate limit',
    'quota exceeded',
    'too many tokens'
  ]

  if (
    rateLimitKeywords.some(keyword =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase())
    )
  ) {
    const rateLimitError: RateLimitError = new Error(
      `API流量限制: ${errorMessage}`
    ) as RateLimitError
    rateLimitError.isRateLimit = true
    rateLimitError.status = status || 429
    rateLimitError.retryAfter = 10
    rateLimitError.code = 'token_quota_exceeded'

    return rateLimitError
  }

  return null
}

// 计算重试延迟（指数退避）
export function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number = 300000
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
  // 添加随机抖动，避免惊群效应
  return delay + Math.random() * 1000
}
