/**
 * 输出上限自动取模型最大值（meta.output）。
 * 背景：推理模型的思考也计入输出 token；不给满时长章节会返回空内容（MiniMax-M3.1-Flash 实测）。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveMaxOutputTokens, estimatePromptTokens, isMaxTokensParamError, resetLearnedParams } from '../src/services/ai/outputBudget'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { GeminiProvider } from '../src/services/ai/geminiProvider'
import { OllamaProvider } from '../src/services/ai/ollamaProvider'
import { computeAIConfig } from '../src/stores/ai-config'
import type { AIState } from '../src/types/ai'

afterEach(() => {
  vi.unstubAllGlobals()
  resetLearnedParams()
})

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const bodyOf = (mock: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(mock.mock.calls[i][1].body))

describe('resolveMaxOutputTokens', () => {
  it('未知上限：不设（交给服务商默认）', () => {
    expect(resolveMaxOutputTokens(undefined, 1_000_000, 100)).toBeUndefined()
    expect(resolveMaxOutputTokens(0, undefined, 100)).toBeUndefined()
  })

  it('上下文充足：给到输入的 4 倍（不按模型最大值预占），不超模型上限', () => {
    expect(resolveMaxOutputTokens(524288, 1_000_000, 50_000)).toBe(200_000)
    expect(resolveMaxOutputTokens(524288, 1_000_000, 200_000)).toBe(524288)
  })

  it('上下文不够：输出预算 = 窗口 − 输入 − 余量，不让请求因超窗被拒', () => {
    // glm-4.5：输出 96K / 窗口 128K，输入 60K
    expect(resolveMaxOutputTokens(98304, 131072, 60_000)).toBe(131072 - 60_000 - 1024)
  })

  it('上下文几乎用尽：保底 1024', () => {
    expect(resolveMaxOutputTokens(64000, 200_000, 199_900)).toBe(1024)
  })

  it('估算按字符数 × 1.25（宁可高估）', () => {
    expect(estimatePromptTokens('abc', undefined, '中文')).toBe(7)
  })

  it('max_tokens 参数名报错识别', () => {
    expect(isMaxTokensParamError(400, "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.")).toBe(true)
    expect(isMaxTokensParamError(400, 'invalid api key')).toBe(false)
    expect(isMaxTokensParamError(500, 'max_tokens')).toBe(false)
  })
})

const base = { apiUrl: 'https://x.test/v1', model: 'm', temperature: 0.3 }

describe('各协议请求体带上模型最大输出', () => {
  it('OpenAI 兼容：max_tokens 由模型元数据推导（短提示 32768，不按 524288 预占）', async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', f)
    await new OpenAIProvider({ ...base, provider: 'openai', maxOutputTokens: 524288, contextWindow: 1_000_000 })
      .generateContent({ prompt: 'p' })
    expect(bodyOf(f).max_tokens).toBe(32768)
  })

  it('OpenAI 兼容：元数据缺失时不发 max_tokens（保持原行为）', async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    await new OpenAIProvider({ ...base, provider: 'openai' }).generateContent({ prompt: 'p' })
    expect(bodyOf(f)).not.toHaveProperty('max_tokens')
  })

  it('OpenAI 推理模型拒绝 max_tokens：改用 max_completion_tokens 重试', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }), { status: 400 })
      )
      .mockResolvedValueOnce(ok({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider({ ...base, provider: 'openai', maxOutputTokens: 128000 }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('ok')
    expect(bodyOf(f, 0).max_tokens).toBe(32768)
    expect(bodyOf(f, 1)).not.toHaveProperty('max_tokens')
    expect(bodyOf(f, 1).max_completion_tokens).toBe(32768)
  })

  it('Anthropic：max_tokens 由模型元数据推导（原先固定 8192）', async () => {
    const f = vi.fn(async () => ok({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    await new AnthropicProvider({ ...base, provider: 'anthropic', maxOutputTokens: 64000, contextWindow: 200_000 })
      .generateContent({ prompt: 'p' })
    expect(bodyOf(f).max_tokens).toBe(32768)
    // 长提示：放宽到模型上限
    await new AnthropicProvider({ ...base, provider: 'anthropic', maxOutputTokens: 64000, contextWindow: 200_000 })
      .generateContent({ prompt: 'x'.repeat(20_000) })
    expect(bodyOf(f, 1).max_tokens).toBe(64000)
  })

  it('Anthropic：元数据缺失仍保底 8192（该协议必填）', async () => {
    const f = vi.fn(async () => ok({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    await new AnthropicProvider({ ...base, provider: 'anthropic' }).generateContent({ prompt: 'p' })
    expect(bodyOf(f).max_tokens).toBe(8192)
  })

  it('Gemini：generationConfig.maxOutputTokens', async () => {
    const f = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
    vi.stubGlobal('fetch', f)
    await new GeminiProvider({ ...base, provider: 'gemini', maxOutputTokens: 8192 }).generateContent({ prompt: 'p' })
    expect(bodyOf(f).generationConfig.maxOutputTokens).toBe(8192)
  })

  it('Ollama：options.num_predict', async () => {
    const f = vi.fn(async () => ok({ message: { content: 'ok' } }))
    vi.stubGlobal('fetch', f)
    await new OllamaProvider({ ...base, provider: 'ollama', maxOutputTokens: 8192 }).generateContent({ prompt: 'p' })
    expect(bodyOf(f).options.num_predict).toBe(8192)
  })
})

describe('运行时配置从模型元数据取上限', () => {
  it('computeAIConfig 把 meta.output / meta.context 带进 aiConfig', () => {
    const ai = {
      providers: [
        {
          id: 'minimax',
          name: 'MiniMax',
          type: 'openai',
          baseUrl: 'https://api.minimaxi.com/v1',
          models: [{ id: 'MiniMax-M3.1-Flash', enabled: true, meta: { output: 524288, context: 1_000_000 } }],
        },
      ],
      active: { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash' },
      defaultTemperature: 0.7,
    } as unknown as AIState
    const cfg = computeAIConfig(ai)
    expect(cfg.maxOutputTokens).toBe(524288)
    expect(cfg.contextWindow).toBe(1_000_000)
  })
})

describe('元数据高于服务商真实上限：按报错里的上限重试', () => {
  it('parseMaxTokensCap 识别三种真实报错', async () => {
    const { parseMaxTokensCap } = await import('../src/services/ai/outputBudget')
    // SenseNova（实测）
    expect(parseMaxTokensCap('field MaxTokens invalid, should be in [1, 384000]', 393216)).toBe(384000)
    // MiniMax（实测）
    expect(parseMaxTokensCap('model[MiniMax-M3.1-Flash] does not support max tokens > 524288 (2013)', 600000)).toBe(524288)
    expect(parseMaxTokensCap('max_tokens must be <= 8192', 16384)).toBe(8192)
    expect(parseMaxTokensCap('invalid api key 12345', 16384)).toBeUndefined()
    expect(parseMaxTokensCap('max_tokens is too large', 16384)).toBeUndefined()
  })

  it('OpenAI 兼容：400 带上限 → 用该上限重发一次', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'field MaxTokens invalid, should be in [1, 384000]', param: 'max_tokens' } }), { status: 400 })
      )
      .mockResolvedValueOnce(ok({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    const long = 'x'.repeat(100_000) // 估算 125000 token → 输出给到模型上限 393216
    const r = await new OpenAIProvider({ ...base, provider: 'openai', maxOutputTokens: 393216 }).generateContent({ prompt: long })
    expect(r.content).toBe('ok')
    expect(bodyOf(f, 0).max_tokens).toBe(393216)
    expect(bodyOf(f, 1).max_tokens).toBe(384000)
  })

  it('Anthropic：同样按报错上限重发', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'max_tokens: 128000 > 64000, which is the maximum allowed' } }), { status: 400 }))
      .mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    const long = 'x'.repeat(30_000)
    const r = await new AnthropicProvider({ ...base, provider: 'anthropic', maxOutputTokens: 128000 }).generateContent({ prompt: long })
    expect(r.content).toBe('ok')
    expect(bodyOf(f, 0).max_tokens).toBe(128000)
    expect(bodyOf(f, 1).max_tokens).toBe(64000)
  })
})

describe('学到的服务商参数：跨 provider 实例、整个会话记住（AIService 每次请求都新建 provider）', () => {
  it('temperature 被拒一次后，新实例的后续请求直接不发', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }), { status: 400 }))
      .mockImplementation(async () => ok({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    const cfg = { ...base, provider: 'openai' as const, providerId: 'openai', model: 'o5' }
    await new OpenAIProvider(cfg).generateContent({ prompt: 'p' })
    await new OpenAIProvider(cfg).generateContent({ prompt: 'p' })
    expect(f).toHaveBeenCalledTimes(3) // 第一次：被拒 + 重发；第二次：直接正确
    expect(bodyOf(f, 2)).not.toHaveProperty('temperature')
    // 不同模型互不影响
    await new OpenAIProvider({ ...cfg, model: 'other' }).generateContent({ prompt: 'p' })
    expect(bodyOf(f, 3).temperature).toBe(0.3)
  })

  it('max_completion_tokens 与服务商上限也被记住', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }), { status: 400 }))
      .mockImplementation(async () => ok({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    const cfg = { ...base, provider: 'openai' as const, providerId: 'openai', model: 'gpt-x', maxOutputTokens: 128000 }
    await new OpenAIProvider(cfg).generateContent({ prompt: 'p' })
    await new OpenAIProvider(cfg).generateContent({ prompt: 'p' })
    expect(f).toHaveBeenCalledTimes(3)
    expect(bodyOf(f, 2)).not.toHaveProperty('max_tokens')
    expect(bodyOf(f, 2).max_completion_tokens).toBe(32768)
  })

  it('Anthropic 开启 thinking 时，按报错上限重发的请求体确实变小（不是原样重发）', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'max_tokens: 128000 > 64000, which is the maximum allowed number of output tokens' } }), { status: 400 }))
      .mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    const r = await new AnthropicProvider({
      ...base, provider: 'anthropic', providerId: 'kiro', model: 'claude-x', maxOutputTokens: 128000, reasoningEffort: 'high',
    }).generateContent({ prompt: 'x'.repeat(30_000) })
    expect(r.content).toBe('ok')
    expect(f).toHaveBeenCalledTimes(2)
    expect(bodyOf(f, 0).max_tokens).toBe(128000)
    expect(bodyOf(f, 1).max_tokens).toBe(64000)
    expect(bodyOf(f, 1).thinking).toEqual({ type: 'enabled', budget_tokens: 12000 })
  })
})

import { getLearnedParams, learnedParamsKey, loadLearnedParams, nextOutputCap, setLearnedParamsPersister } from '../src/services/ai/outputBudget'

describe('输出上限 0.8× 退避（最多 3 次）+ 只存档验证成功的值', () => {
  const tooLarge = () =>
    new Response(JSON.stringify({ error: { message: 'max_tokens is too large for this model' } }), { status: 400 })
  const okBody = () => ok({ choices: [{ message: { content: 'ok' } }] })
  const longPrompt = 'x'.repeat(100_000) // 估算 125000 token → 输出预算给到模型上限
  const cfg = { ...base, provider: 'openai' as const, providerId: 'gw', model: 'm1', maxOutputTokens: 100_000 }

  it('nextOutputCap：有可信上限用上限；否则仅输出上限 / 上下文超限才 ×0.8；无关 400 不退避', () => {
    expect(nextOutputCap(400, 'field MaxTokens invalid, should be in [1, 384000]', 393216)).toBe(384000)
    expect(nextOutputCap(400, 'max_tokens is too large', 10000)).toBe(8000)
    expect(nextOutputCap(400, "This model's maximum context length is 131072 tokens", 10000)).toBe(8000)
    expect(nextOutputCap(400, 'invalid api key', 10000)).toBeUndefined()
    expect(nextOutputCap(400, 'output new_sensitive (1027)', 10000)).toBeUndefined()
    expect(nextOutputCap(400, 'max_tokens is too large', 1200)).toBeUndefined() // 再退就低于保底 1024
  })

  it('读不出上限：×0.8 退避后成功 → 记住并上报后端（只报验证成功的值）', async () => {
    const reported: unknown[] = []
    setLearnedParamsPersister((e) => reported.push(e))
    const f = vi.fn().mockResolvedValueOnce(tooLarge()).mockResolvedValueOnce(tooLarge()).mockImplementation(async () => okBody())
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider(cfg).generateContent({ prompt: longPrompt })
    expect(r.content).toBe('ok')
    expect([0, 1, 2].map((i) => bodyOf(f, i).max_tokens)).toEqual([100_000, 80_000, 64_000])
    const key = learnedParamsKey('gw', base.apiUrl, 'm1')
    expect(getLearnedParams(key).outputCap).toBe(64_000)
    expect(reported).toEqual([{ [key]: { outputCap: 64_000 } }])
    setLearnedParamsPersister(undefined)
  })

  it('最多退避 3 次；退避后仍报同一错误 → 失败，且不记住、不上报', async () => {
    const reported: unknown[] = []
    setLearnedParamsPersister((e) => reported.push(e))
    const f = vi.fn().mockImplementation(async () => tooLarge())
    vi.stubGlobal('fetch', f)
    await expect(new OpenAIProvider({ ...cfg, model: 'm2' }).generateContent({ prompt: longPrompt })).rejects.toThrow()
    // 首发 + 3 次退避 = 4 次（重试层可能对 4xx 不再重试；只数本 provider 内的降级尝试）
    const caps = f.mock.calls.map((_, i) => bodyOf(f, i).max_tokens)
    expect(caps.slice(0, 4)).toEqual([100_000, 80_000, 64_000, 51_200])
    expect(new Set(caps).size).toBe(4) // 不会退避第 4 次
    expect(getLearnedParams(learnedParamsKey('gw', base.apiUrl, 'm2')).outputCap).toBeUndefined()
    expect(reported).toEqual([])
    setLearnedParamsPersister(undefined)
  })

  it('后端存档导入：新会话第一次请求就直接用已验证的上限', async () => {
    loadLearnedParams({ [learnedParamsKey('gw', base.apiUrl, 'm3')]: { outputCap: 50_000, noTemperature: true } })
    const f = vi.fn().mockImplementation(async () => okBody())
    vi.stubGlobal('fetch', f)
    await new OpenAIProvider({ ...cfg, model: 'm3' }).generateContent({ prompt: longPrompt })
    expect(f).toHaveBeenCalledTimes(1)
    expect(bodyOf(f).max_tokens).toBe(50_000)
    expect(bodyOf(f)).not.toHaveProperty('temperature')
  })

  it('学习表单调：更大的上限 / 关掉的旗标不会覆盖已有经验', () => {
    const key = learnedParamsKey('gw', base.apiUrl, 'm4')
    loadLearnedParams({ [key]: { outputCap: 40_000, noTemperature: true } })
    loadLearnedParams({ [key]: { outputCap: 90_000, noTemperature: false } })
    expect(getLearnedParams(key)).toMatchObject({ outputCap: 40_000, noTemperature: true })
  })

  it('Anthropic thinking 开启：以实际发出的 thinking max_tokens 为基准退避，成功才存档', async () => {
    const reported: unknown[] = []
    setLearnedParamsPersister((e) => reported.push(e))
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'max_tokens: value too large' } }), { status: 400 }))
      .mockImplementation(async () => ok({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    await new AnthropicProvider({
      ...base, provider: 'anthropic', providerId: 'kiro', model: 'c1', maxOutputTokens: 64000, reasoningEffort: 'high',
    }).generateContent({ prompt: 'x'.repeat(30_000) })
    expect(bodyOf(f, 0).max_tokens).toBe(64000)
    expect(bodyOf(f, 1).max_tokens).toBe(51200)
    expect(reported).toEqual([{ [learnedParamsKey('kiro', base.apiUrl, 'c1')]: { outputCap: 51200 } }])
    setLearnedParamsPersister(undefined)
  })
})
