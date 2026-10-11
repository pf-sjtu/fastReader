import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildAiProxyTarget,
  calculateRetryDelay,
  identifyRateLimitError,
  proxyFetch,
} from '../src/services/ai/utils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildAiProxyTarget', () => {
  it('chat/completions：base 保留前缀路径', () => {
    expect(buildAiProxyTarget('https://api.openai.com/v1/chat/completions')).toEqual({
      base: 'https://api.openai.com/v1',
      path: 'chat/completions',
    })
  })

  it('api/chat（Ollama）', () => {
    expect(buildAiProxyTarget('http://localhost:11434/api/chat')).toEqual({
      base: 'http://localhost:11434',
      path: 'api/chat',
    })
  })

  it('/v1/models 不再拼成 /v1/models/v1/models', () => {
    expect(buildAiProxyTarget('https://api.openai.com/v1/models')).toEqual({
      base: 'https://api.openai.com',
      path: 'v1/models',
    })
  })

  it('/api/tags', () => {
    expect(buildAiProxyTarget('http://localhost:11434/api/tags')).toEqual({
      base: 'http://localhost:11434',
      path: 'api/tags',
    })
  })

  it('带尾斜杠', () => {
    expect(buildAiProxyTarget('https://x.com/v1/models/')).toEqual({ base: 'https://x.com', path: 'v1/models' })
    expect(buildAiProxyTarget('https://x.com/v1/chat/completions/')).toEqual({
      base: 'https://x.com/v1',
      path: 'chat/completions',
    })
  })
})

describe('proxyFetch（浏览器）', () => {
  it('转发到同源 /api/ai 并设置 X-AI-Base 与原请求头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await proxyFetch('https://api.x.com/v1/models', { method: 'GET', headers: { Authorization: 'Bearer a' } })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${window.location.origin}/api/ai?path=v1%2Fmodels`)
    const headers = new Headers(init.headers)
    expect(headers.get('X-AI-Base')).toBe('https://api.x.com')
    expect(headers.get('X-Request-Origin')).toBe(window.location.origin)
    expect(headers.get('Authorization')).toBe('Bearer a')
  })
})

describe('identifyRateLimitError', () => {
  it('429 识别并读响应体 retry_after', () => {
    const e = identifyRateLimitError(new Error('x'), 429, '{"retry_after": 3}')
    expect(e?.isRateLimit).toBe(true)
    expect(e?.retryAfter).toBe(3)
  })

  it('上下文超长与 4xx 不算限流', () => {
    expect(identifyRateLimitError(new Error('too many tokens'), 429)).toBeNull()
    expect(identifyRateLimitError(new Error('bad request'), 400)).toBeNull()
  })

  it('无状态的限流关键词', () => {
    expect(identifyRateLimitError(new Error('Rate limit reached'))?.isRateLimit).toBe(true)
  })
})

describe('calculateRetryDelay', () => {
  it('指数退避且不超过上限', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(calculateRetryDelay(1, 1000)).toBe(1000)
    expect(calculateRetryDelay(2, 1000)).toBe(2000)
    expect(calculateRetryDelay(20, 1000, 5000)).toBe(5000)
  })
})
