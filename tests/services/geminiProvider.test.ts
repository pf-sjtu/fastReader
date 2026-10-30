/**
 * GeminiProvider：REST 实现（不再依赖 @google/generative-ai 浏览器 SDK）
 *
 * Key 只在服务端，由 /api/ai 注入 x-goog-api-key；客户端只传服务商 id 与端点路径。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiProvider } from '../../src/services/ai/geminiProvider'
import { resetProviderCooldowns } from '../../src/services/ai/retry'

vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type FetchArgs = [string, RequestInit]

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function geminiResponse(text: string, finishReason = 'STOP', totalTokenCount = 10) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { totalTokenCount },
  })
}

/** 从代理 URL 里取回端点路径（服务端据此定位上游地址） */
function proxyPath(url: string): string {
  return decodeURIComponent(new URL(url, 'http://localhost').searchParams.get('path') ?? '')
}

const config = {
  provider: 'gemini' as const,
  providerId: 'p-gemini',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.0-flash',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetProviderCooldowns()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GeminiProvider', () => {
  it('打 {baseUrl}/models/{model}:streamGenerateContent?alt=sse（流式，避开代理 100s 超时）；systemPrompt 合并到用户提示；统计 token', async () => {
    fetchMock.mockResolvedValue(geminiResponse('答案'))
    const onTokenUsage = vi.fn()
    const ctrl = new AbortController()
    const provider = new GeminiProvider({ ...config, temperature: 0.3 }, { onTokenUsage, maxRetries: 1 })

    const res = await provider.generateContent(
      { prompt: '正文', systemPrompt: '请用中文回复。' },
      { signal: ctrl.signal }
    )

    expect(res).toMatchObject({ content: '答案', tokenCount: 10, finishReason: 'STOP' })
    expect(res.truncated).toBeUndefined()
    expect(onTokenUsage).toHaveBeenCalledWith(10)

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('/api/ai?path=')
    // 默认流式：非流式在 Cloudflare 同源代理上超过 100 秒会被切成 524
    expect(proxyPath(url)).toBe('models/gemini-2.0-flash:streamGenerateContent?alt=sse')

    const headers = new Headers(init.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Provider-Id')).toBe('p-gemini')
    // 凭据只由服务端注入：客户端不带 x-goog-api-key / Authorization
    expect(headers.get('x-goog-api-key')).toBeNull()
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('X-AI-Base')).toBeNull()
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(ctrl.signal)

    const body = JSON.parse(init.body as string)
    expect(body.generationConfig).toEqual({ temperature: 0.3 })
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '正文\n\n**请用中文回复。**' }] }])
  })

  it('没有 systemPrompt 时不追加尾注', async () => {
    fetchMock.mockResolvedValue(geminiResponse('ok'))
    await new GeminiProvider(config, { maxRetries: 1 }).generateContent({ prompt: '正文' })
    const body = JSON.parse((fetchMock.mock.calls[0] as FetchArgs)[1].body as string)
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '正文' }] }])
  })

  it('MAX_TOKENS 标记截断', async () => {
    fetchMock.mockResolvedValue(geminiResponse('半截', 'MAX_TOKENS'))
    const res = await new GeminiProvider(config, { maxRetries: 1 }).generateContent({ prompt: 'p' })
    expect(res.truncated).toBe(true)
    expect(res.finishReason).toBe('MAX_TOKENS')
  })

  it('4xx 不重试，保留 status', async () => {
    fetchMock.mockResolvedValue(new Response('API key not valid', { status: 400, statusText: 'Bad Request' }))
    await expect(
      new GeminiProvider(config, { maxRetries: 3 }).generateContent({ prompt: 'p' })
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('testConnection 走 GET /models，成功与失败', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    await expect(new GeminiProvider(config).testConnection()).resolves.toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(proxyPath(url)).toBe('models')
    expect((init.method ?? 'GET')).toBe('GET')

    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403, statusText: 'Forbidden' }))
    const failed = await new GeminiProvider(config).testConnection()
    expect(failed.success).toBe(false)
    expect(failed.error).toContain('403')

    fetchMock.mockRejectedValueOnce(new Error('net down'))
    await expect(new GeminiProvider(config).testConnection()).resolves.toEqual({
      success: false,
      error: 'net down',
    })
  })
})
