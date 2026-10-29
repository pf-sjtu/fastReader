/**
 * Anthropic Messages 协议：Kiro 等网关只提供 /v1/messages（/chat/completions 返回 404，已实测）。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { createAIProvider } from '../src/services/ai/factory'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { onRequest as aiProxy } from '../functions/api/ai/[[path]].js'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { authHeadersForProtocol } from '../functions/_lib/upstream.js'
import { createEnv } from './__mocks__/memoryKv'

afterEach(() => vi.unstubAllGlobals())

const config = {
  provider: 'anthropic' as const,
  providerId: 'kiro',
  apiUrl: 'https://kiro.navira.blog/v1',
  model: 'claude-haiku-4-5',
  temperature: 0.3,
}

describe('AnthropicProvider', () => {
  it('请求 /messages，system 独立字段，只取 text 块，统计 input+output token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: '不应进入正文' },
            { type: 'text', text: '本章' },
            { type: 'text', text: '总结' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const usage = vi.fn()
    const provider = new AnthropicProvider(config, { onTokenUsage: usage })
    const result = await provider.generateContent({ prompt: '总结这一章', systemPrompt: '请用中文回复。' })

    expect(result.content).toBe('本章总结')
    expect(result.tokenCount).toBe(120)
    expect(usage).toHaveBeenCalledWith(120)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.system).toBe('请用中文回复。')
    expect(body.messages).toEqual([{ role: 'user', content: '总结这一章' }])
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.model).toBe('claude-haiku-4-5')
    // 非浏览器环境直连；浏览器内会改走 /api/ai?path=messages
    expect(url).toBe('https://kiro.navira.blog/v1/messages')
  })

  it('stop_reason=max_tokens 映射为 length（交给通用截断判定）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }], stop_reason: 'max_tokens', usage: {} }), {
          status: 200,
        })
      )
    )
    const result = await new AnthropicProvider(config).generateContent({ prompt: 'p' })
    expect(result.finishReason).toBe('length')
  })

  it('factory 按 provider=anthropic 创建', () => {
    expect(createAIProvider(config)).toBeInstanceOf(AnthropicProvider)
  })
})

describe('服务端注入 Anthropic 鉴权头', () => {
  it('anthropic 协议用 x-api-key + anthropic-version，不发 Bearer', () => {
    expect(authHeadersForProtocol('anthropic', 'k')).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
    expect(authHeadersForProtocol('openai', 'k')).toEqual({ Authorization: 'Bearer k' })
  })

  it('/api/ai 按服务商协议注入，且丢弃客户端伪造的 x-api-key', async () => {
    const env = createEnv()
    await env.FASTREADER_KV.put(
      'state:ai',
      JSON.stringify({
        rev: 1,
        updatedAt: '',
        data: {
          providers: [
            { id: 'kiro', type: 'anthropic', baseUrl: 'https://kiro.navira.blog/v1', apiKey: 'sk-server', models: [] },
          ],
          active: { providerId: 'kiro', modelId: 'm' },
        },
      })
    )
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const url = new URL('https://fast-read.pages.dev/api/ai')
    url.searchParams.set('path', 'messages')
    const res = await aiProxy({
      request: new Request(url, {
        method: 'POST',
        headers: { 'X-Provider-Id': 'kiro', 'x-api-key': 'attacker', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env,
    })
    expect(res.status).toBe(200)
    const req = fetchMock.mock.calls[0][0] as unknown as Request
    expect(req.url).toBe('https://kiro.navira.blog/v1/messages')
    expect(req.headers.get('x-api-key')).toBe('sk-server')
    expect(req.headers.get('anthropic-version')).toBe('2023-06-01')
    expect(req.headers.get('authorization')).toBeNull()
  })
})
