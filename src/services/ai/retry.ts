/**
 * AI 请求的错误分类、可取消等待、Retry-After 解析与 provider 级 429 冷却闸门
 */

/** 非 429 的瞬时错误（5xx/408/网络）退避基数上限：用户配置的基数（默认 60s）用于 429，瞬时错误不必等那么久 */
export const RETRY_TRANSIENT_BASE_MAX_MS = 5_000
/** 单次重试等待上限（含服务端给出的 Retry-After） */
export const RETRY_MAX_DELAY_MS = 300_000
/** 抖动上限，避免并发请求同时重试 */
export const RETRY_JITTER_MS = 1_000
/** 未配置 baseRetryDelay 时的默认基数 */
export const DEFAULT_RETRY_BASE_MS = 60_000

/** 保留 HTTP 状态与响应体的 AI 请求错误 */
export class AIRequestError extends Error {
  readonly status?: number
  readonly body?: string
  /** 服务端建议的重试等待（毫秒），来自 Retry-After 头或响应体 */
  readonly retryAfterMs?: number

  constructor(message: string, init: { status?: number; body?: string; retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'AIRequestError'
    this.status = init.status
    this.body = init.body
    this.retryAfterMs = init.retryAfterMs
  }
}

export function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

/** 可被 signal 中断的 sleep；中断时抛 AbortError */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 让一个不支持 signal 的 Promise 在 abort 时由客户端放弃等待（请求本身不会被取消） */
export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

/**
 * 解析 Retry-After 头：秒数或 HTTP 日期；无效返回 undefined
 */
export function parseRetryAfterHeader(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000)
  }
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

/** 从响应体 JSON 中读 retry_after / retryAfter（秒）或 Gemini RetryInfo.retryDelay（"30s"） */
export function parseRetryAfterBody(body: string | undefined): number | undefined {
  if (!body) return undefined
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return undefined
  }
  return findRetryAfter(data, 0)
}

function findRetryAfter(node: unknown, depth: number): number | undefined {
  if (!node || typeof node !== 'object' || depth > 4) return undefined
  const obj = node as Record<string, unknown>
  for (const key of ['retry_after', 'retryAfter']) {
    const v = obj[key]
    if (typeof v === 'number' && v >= 0) return Math.round(v * 1000)
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  }
  const delay = obj.retryDelay
  if (typeof delay === 'string') {
    const m = delay.match(/^(\d+(?:\.\d+)?)s$/)
    if (m) return Math.round(Number(m[1]) * 1000)
  }
  for (const v of Object.values(obj)) {
    const found = findRetryAfter(v, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export type ErrorKind = 'abort' | 'context' | 'rateLimit' | 'retryable' | 'fatal'

const CONTEXT_KEYWORDS = [
  'context length',
  'context_length',
  'context window',
  'maximum context',
  'too many tokens',
  'prompt is too long',
  'input is too long',
  'request too large',
  'reduce the length',
]

const RATE_LIMIT_KEYWORDS = [
  'rate_limit_exceeded',
  'rate limit',
  'too many requests',
  'tokens per minute',
  'resource_exhausted',
]

const NETWORK_KEYWORDS = [
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'network error',
  'load failed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'socket hang up',
]

function getStatus(error: unknown): number | undefined {
  const s = (error as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}

/**
 * 错误分类（顺序有意义）：
 * 1. 取消 → 立即抛出
 * 2. 上下文超长 / 请求体过大 → 立即失败（先于 429 判断：部分网关对超长返回 429 + "too many tokens"）
 * 3. 有 HTTP 状态：429 → 限流；408/5xx → 可重试；其他 4xx → 立即失败
 * 4. 无状态：网络错误可重试，限流关键词按限流，其余立即失败
 */
export function classifyError(error: unknown): ErrorKind {
  if (isAbortError(error)) return 'abort'
  const status = getStatus(error)
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? '').toLowerCase()

  // "too many tokens per minute" 之类是 TPM 限流，不是上下文超长
  const isPerMinuteQuota = /per min|\btpm\b|\brpm\b/.test(msg)
  if (status === 413 || (!isPerMinuteQuota && CONTEXT_KEYWORDS.some((k) => msg.includes(k)))) {
    return 'context'
  }

  if (status !== undefined) {
    if (status === 429) return 'rateLimit'
    if (status === 408 || status >= 500) return 'retryable'
    return 'fatal'
  }

  if (isPerMinuteQuota || RATE_LIMIT_KEYWORDS.some((k) => msg.includes(k))) return 'rateLimit'
  if (error instanceof TypeError || NETWORK_KEYWORDS.some((k) => msg.includes(k))) return 'retryable'
  return 'fatal'
}

/** 服务端建议的等待：错误上的 retryAfterMs 优先，其次从响应体解析 */
export function getServerRetryAfterMs(error: unknown): number | undefined {
  const e = error as { retryAfterMs?: unknown; body?: unknown; errorDetails?: unknown } | null
  if (typeof e?.retryAfterMs === 'number') return e.retryAfterMs
  if (typeof e?.body === 'string') {
    const fromBody = parseRetryAfterBody(e.body)
    if (fromBody !== undefined) return fromBody
  }
  // Gemini SDK 的 GoogleGenerativeAIFetchError.errorDetails 里可能带 RetryInfo
  if (e?.errorDetails) return findRetryAfter({ details: e.errorDetails }, 0)
  return undefined
}

/** 指数退避 + 抖动 */
export function backoffDelay(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const delay = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), RETRY_MAX_DELAY_MS)
  return delay + random() * RETRY_JITTER_MS
}

/**
 * provider 级共享冷却闸门：任一请求收到 429 后，同一 provider 的其他请求在冷却结束前不发出。
 * AIService 每次调用都会新建 provider 实例，所以闸门按 key 存在模块级 Map 中。
 */
const cooldownUntil = new Map<string, number>()

export function setProviderCooldown(key: string, ms: number, now = Date.now()): void {
  const until = now + Math.max(0, ms)
  if (until > (cooldownUntil.get(key) ?? 0)) cooldownUntil.set(key, until)
}

export function getProviderCooldownRemaining(key: string, now = Date.now()): number {
  const until = cooldownUntil.get(key)
  if (until === undefined) return 0
  const remaining = until - now
  if (remaining <= 0) {
    cooldownUntil.delete(key)
    return 0
  }
  return remaining
}

/** 等待冷却结束（循环检查：等待期间可能被其他请求延长） */
export async function waitProviderCooldown(key: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  let remaining = getProviderCooldownRemaining(key)
  while (remaining > 0) {
    await abortableSleep(remaining, signal)
    remaining = getProviderCooldownRemaining(key)
  }
}

/** 仅测试用：清空所有冷却 */
export function resetProviderCooldowns(): void {
  cooldownUntil.clear()
}
