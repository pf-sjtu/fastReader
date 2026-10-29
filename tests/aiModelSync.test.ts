/**
 * 模型自动同步：配好服务商后，模型列表由 /models + 实测 + models.dev 自动生成。
 * 用例里的模型 id 取自真实上游返回（OpenAI、navira 聚合网关、商汤）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  classifyProbe,
  filterModelIds,
  isChatModelId,
  isModelListStale,
  probeRequest,
  shouldEnable,
  syncProviderModels,
  MODEL_SYNC_TTL_MS,
} from '../src/services/ai/modelSync'
import type { ProviderEntry } from '../src/types/ai'

const provider = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
  id: 'p',
  name: 'P',
  type: 'openai',
  baseUrl: 'https://api.example.com/v1',
  models: [],
  ...over,
})

describe('过滤非对话模型与日期快照', () => {
  it('去掉向量 / 语音 / 图像 / 审核 / 实时等模型', () => {
    for (const id of [
      'text-embedding-3-large', 'whisper-1', 'tts-1-hd', 'gpt-realtime-mini', 'gpt-image-1-mini',
      'dall-e-3', 'omni-moderation-latest', 'gpt-4o-transcribe', 'sora-2', 'sensenova-u1.5-lite',
      'deepseek-v4-flash-vision-exp', 'babbage-002', 'gpt-3.5-turbo-instruct-0914',
    ]) {
      expect(isChatModelId(id), id).toBe(false)
    }
    for (const id of ['gpt-4o-mini', 'MiniMax-M3.1-Flash', 'glm-5.3', 'claude-sonnet-4-5', 'deepseek-v4-flash']) {
      expect(isChatModelId(id), id).toBe(true)
    }
  })

  it('有别名时去掉带日期快照；只有快照时保留', () => {
    expect(filterModelIds(['gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-mini', 'gpt-4o-mini-2024-07-18'])).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ])
    expect(filterModelIds(['only-model-2025-01-01'])).toEqual(['only-model-2025-01-01'])
  })

  it('服务商级 include：聚合网关只要转接商汤的模型', () => {
    const navira = ['sensenova/kimi-k3', 'sensenova/glm-5.2', 'claude-opus-4-5', 'grok-4.5', 'sensenova/sensenova-u1.5-lite']
    expect(filterModelIds(navira, { include: ['sensenova/'] })).toEqual(['sensenova/kimi-k3', 'sensenova/glm-5.2'])
  })

  it('支持 /正则/ 规则与 exclude', () => {
    expect(filterModelIds(['a-pro', 'a-flash', 'b-flash'], { include: ['/flash$/'], exclude: ['b-'] })).toEqual(['a-flash'])
  })

  it('去重并忽略空串', () => {
    expect(filterModelIds(['m', 'm', '', '  '])).toEqual(['m'])
  })
})

describe('实测结果分类', () => {
  it('按上游真实返回归类', () => {
    expect(classifyProbe(200, '{"choices":[{"message":{"content":"OK"}}]}')).toEqual({ status: 'ok' })
    expect(classifyProbe(200, '{"choices":[]}').status).toBe('empty')
    expect(classifyProbe(403, 'model is not available in the current token plan').status).toBe('denied')
    expect(classifyProbe(404, 'model is not found').status).toBe('not_found')
    expect(classifyProbe(400, '{"code":"model_not_found"}').status).toBe('not_found')
    expect(classifyProbe(429, 'inference exceeds tpm/rpm limit').status).toBe('rate_limited')
    expect(classifyProbe(500, '').status).toBe('error')
  })

  it('限流是暂时的：仍启用；无权限/下线/空结果：停用', () => {
    expect(shouldEnable({ status: 'rate_limited' })).toBe(true)
    expect(shouldEnable(undefined)).toBe(true)
    expect(shouldEnable({ status: 'denied' })).toBe(false)
    expect(shouldEnable({ status: 'not_found' })).toBe(false)
    expect(shouldEnable({ status: 'empty' })).toBe(false)
  })
})

describe('syncProviderModels', () => {
  // 服务端 /api/catalog/lookup 的返回形态（已合并多数据源）
  const lookupMeta = async (ids: string[]) =>
    Object.fromEntries(
      ids
        .filter((id) => id === 'gpt-4o-mini')
        .map((id) => [id, { meta: { context: 128000, inputCost: 0.15, outputCost: 0.6 }, name: 'GPT-4o mini' }])
    )

  it('拉取 → 过滤 → 实测 → 补元数据，不可用模型停用并注明原因', async () => {
    const result = await syncProviderModels(provider({ catalogId: 'openai' }), {
      listModels: async () => ['gpt-4o-mini', 'whisper-1', 'gpt-5-pro', 'gpt-4o-mini-2024-07-18'],
      probe: async (id) => (id === 'gpt-5-pro' ? { status: 'denied', reason: '当前套餐无权限' } : { status: 'ok' }),
      lookupMeta,
    })

    expect(result.models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-5-pro'])
    const mini = result.models.find((m) => m.id === 'gpt-4o-mini')!
    expect(mini).toMatchObject({
      enabled: true,
      source: 'auto',
      label: 'GPT-4o mini',
      meta: { context: 128000, inputCost: 0.15 },
    })
    const pro = result.models.find((m) => m.id === 'gpt-5-pro')!
    expect(pro.enabled).toBe(false)
    expect(pro.label).toContain('当前套餐无权限')
    expect(result.disabled).toEqual([{ id: 'gpt-5-pro', reason: '当前套餐无权限' }])
    expect(result).toMatchObject({ fetched: 4, kept: 2, added: 2 })
  })

  it('再次同步：保留用户的启用开关与温度，删除上游已下线的自动模型，手动模型不动', async () => {
    const existing = provider({
      models: [
        { id: 'kept', enabled: false, source: 'auto', temperature: 0.2 },
        { id: 'gone', enabled: true, source: 'auto' },
        { id: 'my-custom', enabled: true, source: 'manual' },
      ],
    })
    const result = await syncProviderModels(existing, {
      listModels: async () => ['kept', 'fresh'],
      probe: async () => ({ status: 'ok' }),
    })
    expect(result.models.map((m) => m.id)).toEqual(['kept', 'fresh', 'my-custom'])
    expect(result.models[0]).toMatchObject({ enabled: false, temperature: 0.2 })
    expect(result.models[1].enabled).toBe(true)
    expect(result.removed).toBe(1)
  })

  it('上次因失败停用的模型恢复后，去掉原因后缀', async () => {
    const existing = provider({
      models: [{ id: 'm', enabled: false, source: 'auto', label: 'm（当前限流，已停用）' }],
    })
    const result = await syncProviderModels(existing, {
      listModels: async () => ['m'],
      probe: async () => ({ status: 'ok' }),
    })
    expect(result.models[0].label).toBe('m')
  })

  it('不提供 probe 时跳过实测（全部按过滤结果启用）', async () => {
    const result = await syncProviderModels(provider(), { listModels: async () => ['a', 'b'] })
    expect(result.models.every((m) => m.enabled)).toBe(true)
  })

  it('实测抛异常的模型记为不可用，不影响其它模型', async () => {
    const result = await syncProviderModels(provider(), {
      listModels: async () => ['ok', 'boom'],
      probe: async (id) => {
        if (id === 'boom') throw new Error('network')
        return { status: 'ok' }
      },
    })
    expect(result.models.find((m) => m.id === 'ok')!.enabled).toBe(true)
    expect(result.models.find((m) => m.id === 'boom')!.enabled).toBe(false)
  })

  it('聚合网关模型很多时只实测前 maxProbes 个', async () => {
    const probe = vi.fn(async () => ({ status: 'ok' as const }))
    await syncProviderModels(provider(), {
      listModels: async () => Array.from({ length: 50 }, (_, i) => `m${i}`),
      probe,
      maxProbes: 10,
    })
    expect(probe).toHaveBeenCalledTimes(10)
  })
})

describe('过期判定与实测请求', () => {
  it('从未同步或超过 TTL 视为过期', () => {
    const now = Date.parse('2026-11-01T00:00:00Z')
    expect(isModelListStale({}, now)).toBe(true)
    expect(isModelListStale({ modelsFetchedAt: new Date(now - 1000).toISOString() }, now)).toBe(false)
    expect(isModelListStale({ modelsFetchedAt: new Date(now - MODEL_SYNC_TTL_MS - 1).toISOString() }, now)).toBe(true)
  })

  it('按协议构造实测请求；OpenAI 兼容给足 max_tokens 防推理模型被截成空', () => {
    expect(probeRequest('anthropic', 'claude').path).toBe('messages')
    expect(probeRequest('gemini', 'gemini-2.5-flash').path).toBe('models/gemini-2.5-flash:generateContent')
    const openai = probeRequest('openai', 'm') as { path: string; body: { max_tokens: number } }
    expect(openai.path).toBe('chat/completions')
    expect(openai.body.max_tokens).toBeGreaterThanOrEqual(128)
  })
})
