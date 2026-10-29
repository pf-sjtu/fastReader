// @vitest-environment node
/**
 * 服务端模型目录：合并 models.dev + OpenRouter + LiteLLM，浏览器只拿预设与按需元数据。
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error Pages Function 为纯 JS 模块，无类型声明
import { buildCatalog, lookupModels, listPresets, normalizeModelId, getCatalog } from '../functions/_lib/catalog.js'
import { createEnv } from './__mocks__/memoryKv'

const MODELS_DEV = {
  'minimax-cn': {
    name: 'MiniMax (China)',
    api: 'https://api.minimaxi.com/v1',
    models: { 'MiniMax-M3.1-Flash': { name: 'MiniMax M3.1 Flash', limit: { context: 1000000 }, cost: { input: 0.15, output: 0.6 } } },
  },
  openai: { name: 'OpenAI', models: { 'gpt-4o-mini': { limit: { context: 128000, output: 16384 }, cost: { input: 0.15, output: 0.6 } } } },
}
const OPENROUTER = {
  data: [
    // models.dev 已有：价格/上下文不应被覆盖，但应补上 reasoning_effort 支持
    {
      id: 'minimax/minimax-m3.1-flash',
      name: 'MiniMax: MiniMax M3.1 Flash',
      context_length: 1048576,
      pricing: { prompt: '0.0000002', completion: '0.0000009' },
      supported_parameters: ['reasoning', 'reasoning_effort', 'temperature'],
      top_provider: { max_completion_tokens: 524288 },
    },
    // models.dev 没有：由 OpenRouter 补齐
    { id: 'moonshotai/kimi-k3', name: 'MoonshotAI: Kimi K3', context_length: 262144, pricing: { prompt: '0.0000006', completion: '0.0000025' } },
  ],
}
const LITELLM = {
  sample_spec: { input_cost_per_token: 0 },
  'deepseek-flash': { mode: 'chat', max_input_tokens: 128000, input_cost_per_token: 1e-7, output_cost_per_token: 4e-7 },
  'text-embedding-3-small': { mode: 'embedding', input_cost_per_token: 2e-8 },
}

const fetcherFor = (overrides: Record<string, unknown> = {}) => async (url: string) => {
  if (url in overrides) {
    const v = overrides[url]
    if (v instanceof Error) throw v
    return v
  }
  if (url.includes('models.dev')) return MODELS_DEV
  if (url.includes('openrouter')) return OPENROUTER
  if (url.includes('litellm')) return LITELLM
  throw new Error('unexpected ' + url)
}

describe('合并多数据源', () => {
  it('优先级 models.dev > OpenRouter > LiteLLM：高优先级的值不被覆盖，空位由后者补齐', async () => {
    const catalog = await buildCatalog(fetcherFor())
    const m = catalog.index['minimax-m3.1-flash']
    expect(m.c).toBe(1000000) // models.dev 的上下文
    expect(m.i).toBe(0.15) // models.dev 的价格
    expect(m.o).toBe(524288) // models.dev 没有输出上限 → OpenRouter 补
    expect(m.e).toBe(true) // 仅 OpenRouter 知道支持 reasoning_effort
    expect(m.src).toEqual(['models.dev', 'openrouter'])

    // 只有 OpenRouter 有：价格从「每 token」换算成「每百万 token」
    expect(catalog.index['kimi-k3']).toMatchObject({ c: 262144, i: 0.6, x: 2.5, src: ['openrouter'] })
    // 只有 LiteLLM 有；非对话模型与 sample_spec 被跳过
    expect(catalog.index['deepseek-flash']).toMatchObject({ c: 128000, i: 0.1, x: 0.4 })
    expect(catalog.index['text-embedding-3-small']).toBeUndefined()
    expect(catalog.sources).toEqual({ modelsDev: 'ok', openRouter: 'ok', liteLlm: 'ok' })
  })

  it('单个数据源失败只降级，不整体失败', async () => {
    const catalog = await buildCatalog(fetcherFor({ 'https://openrouter.ai/api/v1/models': new Error('down') }))
    expect(catalog.sources.openRouter).toBe('failed')
    expect(catalog.index['gpt-4o-mini']).toBeTruthy()
  })

  it('全部失败才报错', async () => {
    const fail = async () => {
      throw new Error('down')
    }
    await expect(buildCatalog(fail)).rejects.toThrow('all catalog sources failed')
  })
})

describe('按需查询与预设', () => {
  it('lookup 只回传请求的 id；catalogId 精确命中优先于归一化', async () => {
    const catalog = await buildCatalog(fetcherFor())
    const out = lookupModels(catalog, ['MiniMax-M3.1-Flash', 'grok-4.5:online', 'nope'], 'minimax-cn')
    expect(Object.keys(out)).toEqual(['MiniMax-M3.1-Flash'])
    expect(out['MiniMax-M3.1-Flash'].n).toBe('MiniMax M3.1 Flash')
  })

  it('预设只列带 api 端点的服务商（体积远小于整份目录）', async () => {
    const catalog = await buildCatalog(fetcherFor())
    const presets = listPresets(catalog)
    expect(presets).toEqual([{ id: 'minimax-cn', name: 'MiniMax (China)', api: 'https://api.minimaxi.com/v1', modelCount: 1 }])
    expect(JSON.stringify(presets).length).toBeLessThan(JSON.stringify(catalog).length / 5)
  })

  it('归一化与前端一致：去前缀与网关后缀', () => {
    expect(normalizeModelId('openai/GPT-5:online')).toBe('gpt-5')
    expect(normalizeModelId('sensenova/kimi-k3')).toBe('kimi-k3')
  })
})

describe('缓存与兜底', () => {
  it('上游全挂时回退 KV 副本并标记 degraded', async () => {
    const env = createEnv()
    const good = await buildCatalog(fetcherFor())
    await env.FASTREADER_KV.put('catalog:merged:v2', JSON.stringify(good))
    const fail = async () => {
      throw new Error('down')
    }
    const { catalog, degraded } = await getCatalog(env, { fetcher: fail })
    expect(degraded).toBe(true)
    expect(catalog.index['gpt-4o-mini']).toBeTruthy()
  })

  it('KV 兜底副本一天最多写一次（省 KV 写额度）', async () => {
    const env = createEnv()
    const fresh = await buildCatalog(fetcherFor())
    await env.FASTREADER_KV.put('catalog:merged:v2', JSON.stringify(fresh))
    const before = await env.FASTREADER_KV.get('catalog:merged:v2')
    await getCatalog(env, { fetcher: fetcherFor() })
    expect(await env.FASTREADER_KV.get('catalog:merged:v2')).toBe(before)
  })
})
