/**
 * models.dev 目录匹配：模型元数据自动补全。
 */
import { describe, it, expect } from 'vitest'
import {
  defaultBaseUrlFor,
  enrichProviderMeta,
  findModelMeta,
  guessCatalogProviderId,
  listPresets,
  normalizeModelId,
  type Catalog,
} from '../src/services/ai/catalog'
import type { ProviderEntry } from '../src/types/ai'

const catalog: Catalog = {
  providers: {
    openai: {
      name: 'OpenAI',
      api: 'https://api.openai.com/v1',
      models: {
        'gpt-5.6-luna': { n: 'GPT-5.6 Luna', c: 400000, o: 128000, i: 1.1, x: 4.4, r: true, t: true },
      },
    },
    google: {
      name: 'Google',
      api: 'https://generativelanguage.googleapis.com',
      models: {
        'gemini-2.5-flash': { n: 'Gemini 2.5 Flash', c: 1048576, o: 65536, i: 0.3, x: 2.5, t: true },
      },
    },
    aihubmix: {
      name: 'AiHubMix',
      api: 'https://aihubmix.com/v1',
      models: {
        'grok-4.5': { c: 256000, o: 64000, i: 3, x: 15 },
        'openai/gpt-5.6-luna': { c: 400000, o: 128000, i: 1.1, x: 4.4, r: true },
      },
    },
    zai: {
      name: 'Z.ai',
      api: 'https://api.z.ai/api/paas/v4',
      models: {
        'glm-5.2': { c: 200000, o: 128000, i: 0.6, x: 2.2 },
      },
    },
  },
}

function provider(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id: 'p1',
    name: 'Gateway',
    type: 'openai',
    baseUrl: 'https://gateway.example/v1',
    models: [],
    ...overrides,
  }
}

describe('模型 id 归一化', () => {
  it('去掉网关后缀与供应商前缀', () => {
    expect(normalizeModelId('grok-4.5:online')).toBe('grok-4.5')
    expect(normalizeModelId('MiniMax-M3:free')).toBe('minimax-m3')
    expect(normalizeModelId('deepseek-ai/DeepSeek-V4-Flash')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('openai/gpt-5.6-luna:beta')).toBe('gpt-5.6-luna')
  })
})

describe('元数据匹配', () => {
  it('catalogId 精确命中，价格/上下文被补全', () => {
    const meta = findModelMeta(catalog, provider({ catalogId: 'aihubmix' }), 'grok-4.5:online')
    expect(meta).toEqual({ context: 256000, output: 64000, inputCost: 3, outputCost: 15 })
  })

  it('按 baseUrl 主机猜出目录 provider', () => {
    expect(guessCatalogProviderId(catalog, 'https://api.openai.com/v1')).toBe('openai')
    expect(guessCatalogProviderId(catalog, 'https://unknown.example/v1')).toBeUndefined()
  })

  it('官方 provider 优先：网关模型也能拿到官方价格', () => {
    // gateway 不在目录里，但模型名与 OpenAI 官方一致 → 用官方价而不是渠道价
    const meta = findModelMeta(catalog, provider(), 'gpt-5.6-luna')
    expect(meta?.inputCost).toBe(1.1)
    expect(meta?.reasoning).toBe(true)
  })

  it('gemini 协议走 google 官方条目', () => {
    const gemini = provider({
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    })
    const meta = findModelMeta(catalog, gemini, 'gemini-2.5-flash')
    expect(meta?.context).toBe(1048576)
    expect(meta?.outputCost).toBe(2.5)
  })

  it('查不到的模型返回 undefined（不套用别的模型价格）', () => {
    expect(findModelMeta(catalog, provider(), 'totally-unknown-model')).toBeUndefined()
  })

  it('空目录不炸', () => {
    expect(findModelMeta({ providers: {} }, provider(), 'gpt-5.6-luna')).toBeUndefined()
  })
})

describe('批量补全', () => {
  it('只为命中元数据的模型补 meta，保留用户已设置的值', () => {
    const entry = provider({
      catalogId: 'aihubmix',
      models: [
        { id: 'grok-4.5:online', enabled: true, source: 'manual' },
        {
          id: 'glm-5.2',
          enabled: true,
          source: 'manual',
          meta: { inputCost: 99 }, // 用户手写的价格不被覆盖
        },
        { id: 'unknown-model', enabled: true, source: 'manual' },
      ],
    })

    const enriched = enrichProviderMeta(catalog, entry)
    expect(enriched.models[0].meta).toMatchObject({ context: 256000, inputCost: 3 })
    expect(enriched.models[1].meta).toMatchObject({ inputCost: 99, outputCost: 2.2 })
    expect(enriched.models[2].meta).toBeUndefined()
  })
})

describe('预设列表', () => {
  it('只列出带 api 端点的服务商，按名称排序', () => {
    const presets = listPresets(catalog)
    expect(presets.map((p) => p.id)).toEqual(['aihubmix', 'google', 'openai', 'zai'])
    expect(presets[0]).toMatchObject({ name: 'AiHubMix', api: 'https://aihubmix.com/v1', modelCount: 2 })
  })

  it('协议默认地址', () => {
    expect(defaultBaseUrlFor('gemini')).toContain('generativelanguage')
    expect(defaultBaseUrlFor('ollama')).toContain('localhost:11434')
    expect(defaultBaseUrlFor('openai')).toBe('https://api.openai.com/v1')
  })
})
