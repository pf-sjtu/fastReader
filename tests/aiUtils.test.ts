import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  calculateRetryDelay,
  identifyRateLimitError,
  proxyFetch,
  toEndpointPath,
} from '../src/services/ai/utils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toEndpointPath（相对服务商 baseUrl 的端点路径）', () => {
  it('chat/completions：去掉 base 前缀，保留部署子路径', () => {
    expect(toEndpointPath('https://x/v1/chat/completions', 'https://x/v1')).toBe('chat/completions')
  })

  it('Gemini 的 models/{model}:generateContent', () => {
    expect(
      toEndpointPath('https://y/v1beta/models/gemini-2.5-flash:generateContent', 'https://y/v1beta')
    ).toBe('models/gemini-2.5-flash:generateContent')
  })

  it('base 带尾斜杠时不会多出斜杠', () => {
    expect(toEndpointPath('https://x/v1/models', 'https://x/v1/')).toBe('models')
  })

  it('URL 不在 base 作用域内：回落到 origin 的 pathname（服务端仍会校验）', () => {
    expect(toEndpointPath('https://api.openai.com/v1/models', 'https://x/v1')).toBe('v1/models')
    expect(toEndpointPath('https://api.openai.com/v1/models', undefined)).toBe('v1/models')
  })

  it('非法 URL 时直接去掉前导斜杠', () => {
    expect(toEndpointPath('/v1/models', undefined)).toBe('v1/models')
  })
})

describe('proxyFetch（浏览器）', () => {
  it('转发到同源 /api/ai?path=…，设置服务商 id 与来源，不再传上游 base 与凭据', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await proxyFetch(
      'https://api.x.com/v1/models',
      { method: 'GET', headers: { Authorization: 'Bearer a' } },
      { providerId: 'p-openai', apiBase: 'https://api.x.com/v1' }
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${window.location.origin}/api/ai?path=models`)
    const headers = new Headers(init.headers)
    // 上游地址与凭据只能由服务端决定
    expect(headers.get('X-AI-Base')).toBeNull()
    expect(headers.get('X-Provider-Id')).toBe('p-openai')
    expect(headers.get('X-Request-Origin')).toBe(window.location.origin)
  })

  it('没有 providerId 时不写该头（服务端会拒绝无归属的请求）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await proxyFetch('https://api.x.com/v1/models', { method: 'GET' }, { apiBase: 'https://api.x.com/v1' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('X-Provider-Id')).toBeNull()
    expect(headers.get('X-Request-Origin')).toBe(window.location.origin)
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
