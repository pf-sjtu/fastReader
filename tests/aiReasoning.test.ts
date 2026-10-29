// @vitest-environment node
/**
 * 思考强度：各协议的参数映射，以及服务商不支持时自动去掉参数重试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  anthropicReasoningParams,
  geminiReasoningParams,
  isUnsupportedParamError,
  openAIReasoningParams,
} from '../src/services/ai/reasoning'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { computeAIConfig } from '../src/stores/ai-config'

afterEach(() => vi.unstubAllGlobals())

describe('参数映射', () => {
  it('OpenAI 兼容：auto 不发参数，off → minimal', () => {
    expect(openAIReasoningParams('auto')).toEqual({})
    expect(openAIReasoningParams(undefined)).toEqual({})
    expect(openAIReasoningParams('off')).toEqual({ reasoning_effort: 'minimal' })
    expect(openAIReasoningParams('high')).toEqual({ reasoning_effort: 'high' })
  })

  it('Anthropic：预算随强度上升，且 max_tokens 必须大于预算', () => {
    expect(anthropicReasoningParams('auto', 8192)).toEqual({ params: {}, maxTokens: 8192 })
    const high = anthropicReasoningParams('high', 8192)
    const budget = (high.params.thinking as { budget_tokens: number }).budget_tokens
    expect(budget).toBeGreaterThan((anthropicReasoningParams('low', 8192).params.thinking as { budget_tokens: number }).budget_tokens)
    expect(high.maxTokens).toBeGreaterThan(budget)
  })

  it('Gemini：off 显式关闭（0），auto 不发', () => {
    expect(geminiReasoningParams('off')).toEqual({ thinkingConfig: { thinkingBudget: 0 } })
    expect(geminiReasoningParams('auto')).toEqual({})
  })

  it('只有「参数不被支持」类的 400 才触发降级重试', () => {
    expect(isUnsupportedParamError(400, 'Unrecognized request argument supplied: reasoning_effort')).toBe(true)
    expect(isUnsupportedParamError(400, 'context length exceeded')).toBe(false)
    expect(isUnsupportedParamError(429, 'reasoning')).toBe(false)
  })
})

describe('运行时视图：模型级覆盖 > 全局 > auto', () => {
  it('computeAIConfig 派生 reasoningEffort', () => {
    const base = {
      providers: [{ id: 'p', name: 'p', type: 'openai' as const, baseUrl: 'https://x/v1', models: [{ id: 'm', enabled: true, source: 'auto' as const }] }],
      active: { providerId: 'p', modelId: 'm' },
      defaultTemperature: 0.7,
    }
    expect(computeAIConfig(base).reasoningEffort).toBe('auto')
    expect(computeAIConfig({ ...base, reasoningEffort: 'low' }).reasoningEffort).toBe('low')
    const override = { ...base, reasoningEffort: 'low' as const }
    override.providers[0].models[0] = { ...override.providers[0].models[0], reasoningEffort: 'high' } as never
    expect(computeAIConfig(override).reasoningEffort).toBe('high')
  })
})

describe('降级重试', () => {
  const okBody = JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } })

  it('OpenAI 兼容：服务商拒绝 reasoning_effort 时去掉参数重试成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OpenAIProvider({ provider: 'openai', apiUrl: 'https://x/v1', model: 'm', temperature: 0.7, reasoningEffort: 'low' })
    const result = await provider.generateContent({ prompt: 'hi' })
    expect(result.content).toBe('OK')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).reasoning_effort).toBe('low')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).reasoning_effort).toBeUndefined()
  })

  it('auto 时不发参数、不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(okBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider({ provider: 'openai', apiUrl: 'https://x/v1', model: 'm', temperature: 0.7 }).generateContent({ prompt: 'hi' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).reasoning_effort).toBeUndefined()
  })

  it('Anthropic：开启 thinking 时 temperature 固定为 1，并带预算', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    await new AnthropicProvider({ provider: 'anthropic', apiUrl: 'https://k/v1', model: 'c', temperature: 0.3, reasoningEffort: 'medium' }).generateContent({ prompt: 'p' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(body.temperature).toBe(1)
    expect(body.max_tokens).toBeGreaterThan(4096)
  })
})
