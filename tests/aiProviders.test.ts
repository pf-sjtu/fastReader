import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIProvider, Provider302 } from '../src/services/ai/openaiProvider'
import { OllamaProvider } from '../src/services/ai/ollamaProvider'
import { isTruncatedFinishReason } from '../src/services/ai/baseProvider'
import { getProviderCooldownRemaining, resetProviderCooldowns } from '../src/services/ai/retry'

vi.mock('../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type FetchArgs = [string, RequestInit]

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function textResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, statusText: 'ERR', headers })
}

const okChat = (content = 'hi', finish = 'stop') =>
  jsonResponse({
    choices: [{ message: { content }, finish_reason: finish }],
    usage: { total_tokens: 42 },
  })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  // 抖动归零，重试等待可预测
  vi.spyOn(Math, 'random').mockReturnValue(0)
  resetProviderCooldowns()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const baseConfig = {
  provider: 'openai' as const,
  apiKey: 'sk-test',
  apiUrl: 'https://api.example.com/v1',
  model: 'gpt-x',
}

function openai(opts: { maxRetries?: number; baseRetryDelay?: number; onTokenUsage?: (n: number) => void } = {}) {
  return new OpenAIProvider(baseConfig, { maxRetries: 3, baseRetryDelay: 1, ...opts })
}

describe('OpenAIProvider', () => {
  it('system prompt 只放 system 消息；经同源代理并传 signal；统计 token', async () => {
    fetchMock.mockResolvedValue(okChat('OK'))
    const onTokenUsage = vi.fn()
    const ctrl = new AbortController()
    const res = await openai({ onTokenUsage }).generateContent(
      { prompt: '正文', systemPrompt: '请用中文回复。' },
      { signal: ctrl.signal }
    )

    expect(res.content).toBe('OK')
    expect(res.truncated).toBeUndefined()
    expect(onTokenUsage).toHaveBeenCalledWith(42)

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('/api/ai?path=chat%2Fcompletions')
    expect(new Headers(init.headers).get('X-AI-Base')).toBe('https://api.example.com/v1')
    expect(init.signal).toBe(ctrl.signal)
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: '请用中文回复。' },
      { role: 'user', content: '正文' },
    ])
  })

  it('finish_reason=length 时标记 truncated', async () => {
    fetchMock.mockResolvedValue(okChat('半截', 'length'))
    const res = await openai().generateContent({ prompt: 'p' })
    expect(res.truncated).toBe(true)
    expect(res.finishReason).toBe('length')
  })

  it.each([400, 401, 403, 404])('%i 立即失败不重试，并保留 status', async (status) => {
    fetchMock.mockResolvedValue(textResponse('bad', status))
    await expect(openai().generateContent({ prompt: 'p' })).rejects.toMatchObject({ status })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('上下文超长（即使是 429 + too many tokens）不重试', async () => {
    fetchMock.mockResolvedValue(textResponse('{"error":"too many tokens in prompt"}', 429))
    await expect(openai().generateContent({ prompt: 'p' })).rejects.toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5xx 与网络错误重试后成功', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('oops', 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okChat('ok'))
    const res = await openai().generateContent({ prompt: 'p' })
    expect(res.content).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('达到最大次数后抛出最后的错误', async () => {
    fetchMock.mockImplementation(async () => textResponse('down', 503))
    await expect(openai({ maxRetries: 2 }).generateContent({ prompt: 'p' })).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('429 遵守 Retry-After，并让同一 provider 的并发请求在冷却期内不发出', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(textResponse('slow down', 429, { 'Retry-After': '3' }))
      .mockImplementation(async () => okChat('ok'))

    const first = openai().generateContent({ prompt: 'a' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getProviderCooldownRemaining(`openai|${baseConfig.apiUrl}`)).toBeGreaterThan(2000)

    // 另一个实例（AIService 每次调用都新建 provider）也应被闸门挡住
    const second = openai().generateContent({ prompt: 'b' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1100)
    await expect(first).resolves.toMatchObject({ content: 'ok' })
    await expect(second).resolves.toMatchObject({ content: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('429 无 Retry-After 时读响应体 retry_after', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(textResponse('{"error":{"retry_after":2}}', 429))
      .mockImplementation(async () => okChat('ok'))
    const p = openai({ baseRetryDelay: 60_000 }).generateContent({ prompt: 'a' })
    await vi.advanceTimersByTimeAsync(1900)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toMatchObject({ content: 'ok' })
  })

  it('重试等待中 abort 立即抛 AbortError', async () => {
    fetchMock.mockImplementation(async () => textResponse('oops', 500))
    const ctrl = new AbortController()
    const p = openai({ baseRetryDelay: 60_000 }).generateContent({ prompt: 'p' }, { signal: ctrl.signal })
    await new Promise((r) => setTimeout(r, 10))
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('已取消的 signal 不发请求', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(openai().generateContent({ prompt: 'p' }, { signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch 抛 AbortError 时不重试', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(openai().generateContent({ prompt: 'p' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('testConnection 请求 /models（代理路径不重复）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(openai().testConnection()).resolves.toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('path=v1%2Fmodels')
    expect(new Headers(init.headers).get('X-AI-Base')).toBe('https://api.example.com')

    fetchMock.mockResolvedValueOnce(textResponse('nope', 401))
    const failed = await openai().testConnection()
    expect(failed.success).toBe(false)
    expect(failed.error).toContain('401')

    fetchMock.mockRejectedValueOnce(new Error('net down'))
    await expect(openai().testConnection()).resolves.toEqual({ success: false, error: 'net down' })
  })

  it('302.ai 默认地址与类型', async () => {
    fetchMock.mockResolvedValue(okChat())
    const p = new Provider302({ ...baseConfig, apiUrl: undefined }, { maxRetries: 1 })
    expect(p.type).toBe('302.ai')
    expect(p.name).toBe('302.AI')
    await p.generateContent({ prompt: 'p' })
    const [, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(new Headers(init.headers).get('X-AI-Base')).toBe('https://api.302.ai/v1')
  })
})

describe('OllamaProvider', () => {
  const ollama = () =>
    new OllamaProvider(
      { provider: 'ollama', apiKey: 'k', apiUrl: 'http://localhost:11434', model: 'qwen' },
      { maxRetries: 2, baseRetryDelay: 1 }
    )

  it('请求 /api/chat，带 Authorization 与 signal；done_reason=length 标记截断', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: 'x' }, done: true, done_reason: 'length' }))
    const ctrl = new AbortController()
    const res = await ollama().generateContent({ prompt: 'p', systemPrompt: 's' }, { signal: ctrl.signal })
    expect(res).toMatchObject({ content: 'x', truncated: true })
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('path=api%2Fchat')
    expect(init.signal).toBe(ctrl.signal)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer k')
    expect(JSON.parse(init.body as string).messages[0]).toEqual({ role: 'system', content: 's' })
  })

  it('done 无 done_reason 视为 stop', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: 'y' }, done: true }))
    const res = await ollama().generateContent({ prompt: 'p' })
    expect(res.finishReason).toBe('stop')
    expect(res.truncated).toBeUndefined()
  })

  it('404（模型不存在）立即失败并保留 status', async () => {
    fetchMock.mockResolvedValue(textResponse('model not found', 404))
    await expect(ollama().generateContent({ prompt: 'p' })).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('testConnection 读 /api/tags', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ name: 'qwen:latest' }] }))
    await expect(ollama().testConnection()).resolves.toEqual({ success: true })
    expect((fetchMock.mock.calls[0] as FetchArgs)[0]).toContain('path=api%2Ftags')

    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    expect((await ollama().testConnection()).success).toBe(false)

    fetchMock.mockResolvedValueOnce(textResponse('x', 500))
    expect((await ollama().testConnection()).error).toContain('500')

    fetchMock.mockRejectedValueOnce(new Error('refused'))
    expect((await ollama().testConnection()).error).toBe('refused')
  })
})

describe('isTruncatedFinishReason', () => {
  it('识别 length / MAX_TOKENS', () => {
    expect(isTruncatedFinishReason('length')).toBe(true)
    expect(isTruncatedFinishReason('MAX_TOKENS')).toBe(true)
    expect(isTruncatedFinishReason('stop')).toBe(false)
    expect(isTruncatedFinishReason(undefined)).toBe(false)
  })
})
