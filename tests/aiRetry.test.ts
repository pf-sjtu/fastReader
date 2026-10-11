import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AIRequestError,
  abortableSleep,
  backoffDelay,
  classifyError,
  getProviderCooldownRemaining,
  getServerRetryAfterMs,
  isAbortError,
  parseRetryAfterBody,
  parseRetryAfterHeader,
  raceWithAbort,
  resetProviderCooldowns,
  RETRY_JITTER_MS,
  RETRY_MAX_DELAY_MS,
  setProviderCooldown,
  throwIfAborted,
  waitProviderCooldown,
} from '../src/services/ai/retry'

afterEach(() => {
  vi.useRealTimers()
  resetProviderCooldowns()
})

describe('classifyError', () => {
  const http = (status: number, message = 'x') => new AIRequestError(message, { status })

  it('408/429/5xx 可重试，429 为限流', () => {
    expect(classifyError(http(429))).toBe('rateLimit')
    expect(classifyError(http(408))).toBe('retryable')
    expect(classifyError(http(500))).toBe('retryable')
    expect(classifyError(http(503))).toBe('retryable')
  })

  it('400/401/403/404 立即失败', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(classifyError(http(s))).toBe('fatal')
    }
  })

  it('上下文超长先于 429 判断', () => {
    expect(classifyError(http(429, 'Too many tokens in request'))).toBe('context')
    expect(classifyError(http(400, "This model's maximum context length is 8192"))).toBe('context')
    expect(classifyError(http(413))).toBe('context')
    expect(classifyError(new Error('prompt is too long'))).toBe('context')
    // TPM 限流不是上下文超长
    expect(classifyError(http(429, 'Too many tokens per minute'))).toBe('rateLimit')
    expect(classifyError(new Error('too many tokens per min'))).toBe('rateLimit')
  })

  it('无状态：网络错误可重试、限流关键词为限流、其他立即失败', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('retryable')
    expect(classifyError(new Error('Error fetching from x: fetch failed'))).toBe('retryable')
    expect(classifyError(new Error('Rate limit reached'))).toBe('rateLimit')
    expect(classifyError(new Error('JSON parse error'))).toBe('fatal')
  })

  it('AbortError 识别', () => {
    const e = new DOMException('Aborted', 'AbortError')
    expect(classifyError(e)).toBe('abort')
    expect(isAbortError(e)).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
  })
})

describe('Retry-After 解析', () => {
  it('秒数与 HTTP 日期', () => {
    expect(parseRetryAfterHeader('5')).toBe(5000)
    expect(parseRetryAfterHeader('1.5')).toBe(1500)
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfterHeader('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfterHeader('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfterHeader('garbage')).toBeUndefined()
    expect(parseRetryAfterHeader(null)).toBeUndefined()
  })

  it('响应体 retry_after / retryAfter / Gemini retryDelay', () => {
    expect(parseRetryAfterBody('{"retry_after": 7}')).toBe(7000)
    expect(parseRetryAfterBody('{"error":{"retryAfter":"2"}}')).toBe(2000)
    expect(
      parseRetryAfterBody('{"error":{"details":[{"@type":"RetryInfo","retryDelay":"30s"}]}}')
    ).toBe(30_000)
    expect(parseRetryAfterBody('not json')).toBeUndefined()
    expect(parseRetryAfterBody(undefined)).toBeUndefined()
    expect(parseRetryAfterBody('{"a":1}')).toBeUndefined()
  })

  it('getServerRetryAfterMs：错误字段优先，其次 body，再次 errorDetails', () => {
    expect(getServerRetryAfterMs(new AIRequestError('x', { retryAfterMs: 123 }))).toBe(123)
    expect(getServerRetryAfterMs(new AIRequestError('x', { body: '{"retry_after":1}' }))).toBe(1000)
    expect(getServerRetryAfterMs({ errorDetails: [{ retryDelay: '4s' }] })).toBe(4000)
    expect(getServerRetryAfterMs(new Error('x'))).toBeUndefined()
  })
})

describe('backoffDelay', () => {
  it('指数增长、封顶、带抖动', () => {
    expect(backoffDelay(1, 1000, () => 0)).toBe(1000)
    expect(backoffDelay(3, 1000, () => 0)).toBe(4000)
    expect(backoffDelay(30, 1000, () => 0)).toBe(RETRY_MAX_DELAY_MS)
    expect(backoffDelay(1, 1000, () => 1)).toBe(1000 + RETRY_JITTER_MS)
  })
})

describe('abortableSleep / raceWithAbort', () => {
  it('signal 中断 sleep 抛 AbortError', async () => {
    const ctrl = new AbortController()
    const p = abortableSleep(60_000, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('已取消的 signal 立即拒绝；无 signal 正常结束', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(abortableSleep(10, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(abortableSleep(1)).resolves.toBeUndefined()
    expect(() => throwIfAborted(ctrl.signal)).toThrow()
  })

  it('raceWithAbort 在 abort 时放弃等待，否则透传结果与错误', async () => {
    const ctrl = new AbortController()
    const never = new Promise<string>(() => {})
    const p = raceWithAbort(never, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })

    await expect(raceWithAbort(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1)
    await expect(raceWithAbort(Promise.reject(new Error('boom')), new AbortController().signal)).rejects.toThrow('boom')
    await expect(raceWithAbort(Promise.resolve(2))).resolves.toBe(2)
    await expect(raceWithAbort(Promise.resolve(3), ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('provider 冷却闸门', () => {
  it('设置后剩余时间递减，过期清除；只延长不缩短', () => {
    const now = 1_000_000
    setProviderCooldown('k', 5000, now)
    expect(getProviderCooldownRemaining('k', now + 1000)).toBe(4000)
    setProviderCooldown('k', 1000, now)
    expect(getProviderCooldownRemaining('k', now)).toBe(5000)
    expect(getProviderCooldownRemaining('k', now + 6000)).toBe(0)
    expect(getProviderCooldownRemaining('other', now)).toBe(0)
  })

  it('waitProviderCooldown 等到冷却结束，可被 abort 中断', async () => {
    vi.useFakeTimers()
    setProviderCooldown('k', 2000)
    let done = false
    const p = waitProviderCooldown('k').then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    await p
    expect(done).toBe(true)

    setProviderCooldown('k', 2000)
    const ctrl = new AbortController()
    const p2 = waitProviderCooldown('k', ctrl.signal)
    ctrl.abort()
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
  })
})
