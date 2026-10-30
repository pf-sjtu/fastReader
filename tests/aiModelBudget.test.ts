/**
 * 模型参数自动化（输入预算 / 分段 / 后处理阈值 / 温度报错）：契约与 CLI 共用 tests/fixtures/model-budget-cases.json
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isTemperatureParamError,
  resolveInputBudget,
  resolvePostProcessLimits,
  splitByBudget,
} from '../src/services/ai/outputBudget'

const cases = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/model-budget-cases.json'), 'utf8'))

describe('共享契约 model-budget-cases.json', () => {
  for (const c of cases.inputBudget) {
    it(`输入预算：${c.name}`, () => {
      expect(resolveInputBudget(c.context ?? undefined, c.output ?? undefined) ?? null).toBe(c.expected)
    })
  }
  for (const c of cases.postProcessLimits) {
    it(`后处理阈值：${c.name}`, () => {
      expect(resolvePostProcessLimits(c.context ?? undefined, c.output ?? undefined)).toEqual(c.expected)
    })
  }
  for (const c of cases.split) {
    it(`分段：${c.name}`, () => {
      const got = splitByBudget(c.text, c.budget)
      expect(got).toEqual(c.expected)
      for (const chunk of got) expect(chunk.length).toBeLessThanOrEqual(c.budget)
    })
  }
  for (const c of cases.temperatureError) {
    it(`温度报错识别：${c.status} ${c.body.slice(0, 30)}`, () => {
      expect(isTemperatureParamError(c.status, c.body)).toBe(c.expected)
    })
  }
})

describe('分段不丢内容', () => {
  it('真实规模：25 万字按 9.6 万预算切分，各段不超预算、去掉分隔后内容完整', () => {
    const paras = Array.from({ length: 800 }, (_, i) => `第${i}段。` + '内容'.repeat(150) + '。')
    const text = paras.join('\n\n')
    const chunks = splitByBudget(text, 96256)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(96256)
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  })
})

import { vi, afterEach } from 'vitest'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { GeminiProvider } from '../src/services/ai/geminiProvider'
import { computeAIConfig } from '../src/stores/ai-config'
import type { AIState } from '../src/types/ai'

afterEach(() => vi.unstubAllGlobals())
const okJson = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
const sent = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(f.mock.calls[i][1].body))
const cfg = { apiUrl: 'https://x.test/v1', model: 'm', temperature: 0.3 }

describe('温度 / 思考强度按元数据自动适配', () => {
  it('目录标注不支持温度：OpenAI 兼容不发 temperature', async () => {
    const f = vi.fn(async () => okJson({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    await new OpenAIProvider({ ...cfg, provider: 'openai', supportsTemperature: false }).generateContent({ prompt: 'p' })
    expect(sent(f)).not.toHaveProperty('temperature')
  })

  it('未标注：照常发送；被拒后去掉 temperature 重试成功', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported." } }), { status: 400 })
      )
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider({ ...cfg, provider: 'openai' }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('ok')
    expect(sent(f, 0).temperature).toBe(0.3)
    expect(sent(f, 1)).not.toHaveProperty('temperature')
  })

  it('目录标注非推理模型：不发 reasoning_effort（省一次被拒请求）', async () => {
    const f = vi.fn(async () => okJson({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', f)
    await new OpenAIProvider({ ...cfg, provider: 'openai', reasoningEffort: 'high', supportsReasoning: false }).generateContent({ prompt: 'p' })
    expect(sent(f)).not.toHaveProperty('reasoning_effort')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('Anthropic：不支持温度则不发；thinking 开启时仍强制 1（协议要求）', async () => {
    const f = vi.fn(async () => okJson({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
    vi.stubGlobal('fetch', f)
    await new AnthropicProvider({ ...cfg, provider: 'anthropic', supportsTemperature: false }).generateContent({ prompt: 'p' })
    expect(sent(f)).not.toHaveProperty('temperature')
    await new AnthropicProvider({ ...cfg, provider: 'anthropic', supportsTemperature: false, reasoningEffort: 'medium' }).generateContent({ prompt: 'p' })
    expect(sent(f, 1).temperature).toBe(1)
  })

  it('Gemini：不支持温度则 generationConfig 不含 temperature', async () => {
    const f = vi.fn(async () => okJson({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
    vi.stubGlobal('fetch', f)
    await new GeminiProvider({ ...cfg, provider: 'gemini', supportsTemperature: false }).generateContent({ prompt: 'p' })
    expect(sent(f).generationConfig).not.toHaveProperty('temperature')
  })

  it('computeAIConfig：只有目录「明确否定」才关闭（undefined 照常发送）', () => {
    const mk = (meta: Record<string, unknown>) =>
      computeAIConfig({
        providers: [{ id: 'p', name: 'P', type: 'openai', baseUrl: 'u', models: [{ id: 'm', enabled: true, meta }] }],
        active: { providerId: 'p', modelId: 'm' },
        defaultTemperature: 0.7,
      } as unknown as AIState)
    expect(mk({ temperature: false, reasoning: false })).toMatchObject({ supportsTemperature: false, supportsReasoning: false })
    const unknown = mk({})
    expect(unknown.supportsTemperature).toBeUndefined()
    expect(unknown.supportsReasoning).toBeUndefined()
  })
})
