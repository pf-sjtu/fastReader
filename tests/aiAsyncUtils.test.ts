import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ConcurrencyLimiter,
  calculateRetryDelay,
  debounce,
  sleep,
  throttle,
  withRetry,
} from '../src/utils/async'
import { createAIProvider, getSupportedProviders, isProviderSupported } from '../src/services/ai/factory'
import { GeminiProvider } from '../src/services/ai/geminiProvider'
import { OllamaProvider } from '../src/services/ai/ollamaProvider'
import { OpenAIProvider, Provider302 } from '../src/services/ai/openaiProvider'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('utils/async 其他工具', () => {
  it('sleep 按时 resolve', async () => {
    vi.useFakeTimers()
    let done = false
    const p = sleep(100).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(99)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toBe(true)
  })

  it('calculateRetryDelay 指数退避封顶', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(calculateRetryDelay(1, 100)).toBe(100)
    expect(calculateRetryDelay(3, 100)).toBe(400)
    expect(calculateRetryDelay(10, 100, 500)).toBe(500)
  })

  it('withRetry 重试直到成功，onRetry 被调用', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const op = vi.fn().mockRejectedValueOnce(new Error('a')).mockResolvedValue('ok')
    const onRetry = vi.fn()
    await expect(withRetry(op, { baseDelay: 1, onRetry })).resolves.toBe('ok')
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
  })

  it('withRetry shouldRetry=false 立即抛出；非 Error 被包装', async () => {
    const op = vi.fn().mockRejectedValue('str')
    await expect(withRetry(op, { shouldRetry: () => false })).rejects.toThrow('str')
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('ConcurrencyLimiter.executeBatch 限制并发', async () => {
    const limiter = new ConcurrencyLimiter(2)
    let running = 0
    let peak = 0
    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return 1
    }
    await expect(limiter.executeBatch([task, task, task, task])).resolves.toEqual([1, 1, 1, 1])
    expect(peak).toBe(2)
  })

  it('debounce 只执行最后一次', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 50)
    d(1)
    d(2)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(2)
  })

  it('throttle 窗口内只执行一次', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 50)
    t(1)
    t(2)
    vi.advanceTimersByTime(50)
    t(3)
    expect(fn.mock.calls).toEqual([[1], [3]])
  })
})

describe('AI provider 工厂', () => {
  const base = { apiKey: 'k', model: 'm' }

  it('按类型创建对应 provider，custom 走 OpenAI 兼容', () => {
    expect(createAIProvider({ ...base, provider: 'gemini' })).toBeInstanceOf(GeminiProvider)
    expect(createAIProvider({ ...base, provider: 'openai' })).toBeInstanceOf(OpenAIProvider)
    expect(createAIProvider({ ...base, provider: '302.ai' })).toBeInstanceOf(Provider302)
    expect(createAIProvider({ ...base, provider: 'ollama' })).toBeInstanceOf(OllamaProvider)
    const custom = createAIProvider({ ...base, provider: 'custom' })
    expect(custom).toBeInstanceOf(OpenAIProvider)
    expect(custom.type).toBe('custom')
  })

  it('不支持的 provider 抛错；支持列表与判定', () => {
    expect(() => createAIProvider({ ...base, provider: 'x' as never })).toThrow('不支持的 AI Provider')
    expect(getSupportedProviders().map((p) => p.type)).toEqual(['gemini', 'openai', '302.ai', 'ollama'])
    expect(isProviderSupported('ollama')).toBe(true)
    expect(isProviderSupported('nope')).toBe(false)
  })
})
