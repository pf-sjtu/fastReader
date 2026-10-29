/**
 * storage：旧配置只读、不写。
 *
 * 共享状态上线后，配置的单一事实来源是服务端（Cloudflare KV），浏览器 localStorage 只剩
 * 「历史版本留下的旧键」用于首次初始化时的一次性导入。本文件验证：
 * 1) legacyMigration 能读懂拆分后的子 store 旧键（`{state, version}` 信封与裸数据两种形态）；
 * 2) 旧快照能转成 ImportPlan（明文密钥单独走 secretKeys，不进客户端可见状态）；
 * 3) 新 store 不再往这些旧键写任何东西。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  LEGACY_AI_KEY,
  LEGACY_CONFIG_KEY,
  LEGACY_CORE_KEY,
  LEGACY_PROCESSING_KEY,
  LEGACY_PROMPT_KEY,
  LEGACY_WEBDAV_KEY,
  buildImportPlanFromLocal,
  hasLocalLegacyConfig,
  readLocalLegacyConfig,
} from '../src/stores/legacyMigration'

type StoresModule = typeof import('../src/stores')

const legacyProviders = [
  { provider: 'openai', apiKey: 'sk-legacy-1', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o', temperature: 0.3 },
  { provider: 'custom', apiKey: 'sk-legacy-2', apiUrl: 'https://x.example/v1', model: 'm2', temperature: 0.5 },
]

/** 拆分后各子 store 的旧键内容（zustand persist 的 {state, version} 信封） */
function splitKeys(): Record<string, unknown> {
  return {
    [LEGACY_AI_KEY]: {
      state: { aiConfigManager: { providers: legacyProviders, currentModelId: 2 }, aiConfig: { apiKey: 'sk-legacy-2' } },
      version: 1,
    },
    [LEGACY_PROCESSING_KEY]: {
      state: {
        processingOptions: { processingMode: 'summary', bookType: 'fiction', outputLanguage: 'zh' },
      },
      version: 1,
    },
    [LEGACY_WEBDAV_KEY]: {
      state: {
        webdavConfig: {
          enabled: true,
          serverUrl: 'https://dav.example/dav/',
          username: 'u',
          password: 'pw-legacy',
          syncPath: '/fr',
          connectionStatus: 'error',
        },
      },
      version: 1,
    },
    [LEGACY_CORE_KEY]: { state: { aiServiceOptions: { maxRetries: 7, baseRetryDelay: 1000 } }, version: 1 },
    [LEGACY_PROMPT_KEY]: {
      state: {
        promptVersionConfig: {
          v1: {
            chapterSummary: { fiction: 'L1', nonFiction: 'L1n' },
            mindmap: { chapter: '', arrow: '', combined: '' },
            connectionAnalysis: '',
            overallSummary: '',
          },
          v2: {
            chapterSummary: { fiction: 'L2', nonFiction: 'L2n' },
            mindmap: { chapter: '', arrow: '', combined: '' },
            connectionAnalysis: '',
            overallSummary: '',
          },
        },
        currentPromptVersion: 'v2',
      },
      version: 1,
    },
  }
}

function seed(entries: Record<string, unknown>) {
  localStorage.clear()
  for (const [key, value] of Object.entries(entries)) {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

/** 写入类调用会把数据发往服务端：这里用内存假 fetch，避免真实网络请求 */
function stubSharedStateApi() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ rev: 1, updatedAt: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  localStorage.clear()
  stubSharedStateApi()
})

describe('readLocalLegacyConfig / hasLocalLegacyConfig', () => {
  it('没有旧数据 ⇒ null（无 storage 也一样）', () => {
    expect(readLocalLegacyConfig(null)).toBeNull()
    expect(readLocalLegacyConfig(localStorage)).toBeNull()
    expect(hasLocalLegacyConfig(null)).toBe(false)
    expect(hasLocalLegacyConfig(localStorage)).toBe(false)
  })

  it('读取拆分后的子 store 键（{state, version} 信封）', () => {
    seed(splitKeys())
    const snapshot = readLocalLegacyConfig(localStorage)!
    expect(snapshot.ai?.providers).toHaveLength(2)
    expect(snapshot.ai?.currentModelId).toBe(2)
    expect(snapshot.processingOptions?.bookType).toBe('fiction')
    expect(snapshot.aiServiceOptions).toEqual({ maxRetries: 7, baseRetryDelay: 1000 })
    expect(snapshot.webdav?.serverUrl).toBe('https://dav.example/dav/')
    expect(snapshot.prompts?.currentPromptVersion).toBe('v2')
    expect(hasLocalLegacyConfig(localStorage)).toBe(true)
  })

  it('裸数据（无 {state} 信封）同样能读', () => {
    seed({
      [LEGACY_AI_KEY]: { aiConfigManager: { providers: legacyProviders, currentModelId: 1 } },
      [LEGACY_PROCESSING_KEY]: { processingOptions: { processingMode: 'mindmap' } },
    })
    const snapshot = readLocalLegacyConfig(localStorage)!
    expect(snapshot.ai?.providers).toHaveLength(2)
    expect(snapshot.processingOptions?.processingMode).toBe('mindmap')
  })

  it('聚合键：读取其支持的快照字段（processingOptions / aiServiceOptions / ai / webdav / prompts）', () => {
    seed({
      [LEGACY_CONFIG_KEY]: {
        state: {
          processingOptions: { processingMode: 'summary', bookType: 'fiction' },
          aiServiceOptions: { maxRetries: 2 },
          ai: { providers: legacyProviders, currentModelId: 1 },
          webdav: { serverUrl: 'https://agg.example/dav/', username: 'u', password: 'pw-agg' },
          prompts: { promptConfig: null },
        },
        version: 0,
      },
    })
    const snapshot = readLocalLegacyConfig(localStorage)!
    expect(snapshot.processingOptions?.bookType).toBe('fiction')
    expect(snapshot.aiServiceOptions?.maxRetries).toBe(2)
    expect(snapshot.ai?.providers).toHaveLength(2)
    expect(snapshot.webdav?.serverUrl).toBe('https://agg.example/dav/')
  })

  it('键值损坏时容错返回 null，不抛错也不清理原值', () => {
    seed({ [LEGACY_CONFIG_KEY]: '{not json' })
    expect(readLocalLegacyConfig(localStorage)).toBeNull()
    expect(localStorage.getItem(LEGACY_CONFIG_KEY)).toBe('{not json')

    // 单个键坏掉不影响其他键
    seed({ [LEGACY_AI_KEY]: '{not json', [LEGACY_PROCESSING_KEY]: { state: { processingOptions: { bookType: 'fiction' } }, version: 1 } })
    const snapshot = readLocalLegacyConfig(localStorage)!
    expect(snapshot.processingOptions?.bookType).toBe('fiction')
    expect(snapshot.ai).toBeUndefined()
  })

  it('只有提示词版本的旧数据也算「有旧配置」', () => {
    seed({
      [LEGACY_PROMPT_KEY]: {
        state: { promptVersionConfig: { v2: { chapterSummary: { fiction: 'F', nonFiction: 'N' } } } },
        version: 0,
      },
    })
    expect(hasLocalLegacyConfig(localStorage)).toBe(true)
    expect(readLocalLegacyConfig(localStorage)?.prompts?.promptVersionConfig?.v2).toBeDefined()
  })
})

describe('buildImportPlanFromLocal', () => {
  it('明文 apiKey 只出现在 providerSecrets，客户端状态只有 {hasSecret}', () => {
    seed(splitKeys())
    const plan = buildImportPlanFromLocal(readLocalLegacyConfig(localStorage)!)

    expect(plan.ai.providers).toHaveLength(2)
    expect(plan.ai.providers.map((p) => p.baseUrl)).toEqual([
      'https://api.openai.com/v1',
      'https://x.example/v1',
    ])
    expect(plan.ai.providers.map((p) => p.apiKey)).toEqual([{ hasSecret: true }, { hasSecret: true }])
    expect(Object.values(plan.providerSecrets).sort()).toEqual(['sk-legacy-1', 'sk-legacy-2'])
    expect(JSON.stringify(plan.ai)).not.toContain('sk-legacy-')
    // currentModelId 是 1-based：第 2 条 → 第二个服务商的 m2
    expect(plan.ai.active).toEqual({ providerId: plan.ai.providers[1].id, modelId: 'm2' })
  })

  it('WebDAV 明文密码单独走 webdavPassword，配置里只标记 hasSecret 且连接状态重置', () => {
    seed(splitKeys())
    const plan = buildImportPlanFromLocal(readLocalLegacyConfig(localStorage)!)

    expect(plan.webdav.password).toEqual({ hasSecret: true })
    expect(plan.webdav.connectionStatus).toBe('disconnected')
    expect(plan.webdavPassword).toBe('pw-legacy')
    expect(JSON.stringify(plan.webdav)).not.toContain('pw-legacy')
  })

  it('处理选项补齐默认值并夹紧，汇率缺省为 7', () => {
    seed({
      [LEGACY_PROCESSING_KEY]: {
        state: {
          processingOptions: { bookType: 'fiction', outputLanguage: 'zh', chapterConcurrency: 99 },
        },
        version: 1,
      },
    })
    const plan = buildImportPlanFromLocal(readLocalLegacyConfig(localStorage)!)

    expect(plan.processing).toMatchObject({
      bookType: 'fiction',
      outputLanguage: 'zh',
      chapterConcurrency: 10, // 99 夹紧到上限
      chapterDetectionMode: 'normal', // 旧文件没有
    })
    expect(plan.exchangeRateUsdToCny).toBe(7)
  })

  it('提示词与内置默认求差：只保留被改过的条目', () => {
    seed(splitKeys())
    const plan = buildImportPlanFromLocal(readLocalLegacyConfig(localStorage)!)

    expect(plan.prompts.chapterSummary).toEqual({ fiction: 'L2', nonFiction: 'L2n' })
    // 空字符串与内置默认不同 ⇒ 视为显式清空，需要保留
    expect(plan.prompts.mindmap).toEqual({ chapter: '', arrow: '', combined: '' })
  })

  it('旧 store 里「当前生效」的完整 promptConfig 优先于版本表', () => {
    seed({
      [LEGACY_PROMPT_KEY]: {
        state: {
          promptConfig: {
            chapterSummary: { fiction: 'CURRENT', nonFiction: 'CURRENT-N' },
            mindmap: { chapter: 'M', arrow: 'A', combined: 'X' },
            connectionAnalysis: 'CA',
            overallSummary: 'OS',
          },
          currentPromptVersion: 'v1',
          promptVersionConfig: { v1: {}, v2: {} },
        },
        version: 1,
      },
    })
    const plan = buildImportPlanFromLocal(readLocalLegacyConfig(localStorage)!)
    expect(plan.prompts.chapterSummary?.fiction).toBe('CURRENT')
    expect(plan.prompts.overallSummary).toBe('OS')
  })

  it('空快照也能生成计划（不抛错），并标注来源', () => {
    const plan = buildImportPlanFromLocal({})
    expect(plan.version).toBe('legacy-local')
    expect(plan.ai.providers).toEqual([])
    expect(plan.webdav.connectionStatus).toBe('disconnected')
    expect(plan.notes).toContain('来源：本浏览器旧配置')
  })
})

describe('新 store 不再写旧 localStorage 键', () => {
  async function boot(): Promise<StoresModule> {
    localStorage.clear()
    vi.resetModules()
    return import('../src/stores')
  }

  it('改各子 store 后旧键仍然不存在（共享状态只写服务端）', async () => {
    const m = await boot()
    m.useProcessingStore.getState().setBookType('fiction')
    m.useProcessingStore.getState().setExchangeRateUsdToCny(7.2)
    m.useWebDAVStore.getState().setWebDAVPassword('pw-new')
    m.usePromptStore.getState().setOverallSummaryPrompt('O')
    m.useAIConfigStore.getState().addProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4o', enabled: true, source: 'manual' }],
    })
    m.useUsageStore.getState().addTokenUsage(10, 0.01)
    m.useProcessingHistoryStore.getState().addRecord({
      bookTitle: 'b',
      fileName: 'b.epub',
      processingMode: 'summary',
      model: 'm',
      chapterCount: 1,
    })

    for (const key of [LEGACY_CONFIG_KEY, LEGACY_AI_KEY, LEGACY_PROCESSING_KEY, LEGACY_WEBDAV_KEY, LEGACY_PROMPT_KEY, LEGACY_CORE_KEY]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    // 也没有别的键把明文密码写进 localStorage
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k) || '')
    expect(stored.filter((v) => v.includes('pw-new'))).toHaveLength(0)
  })
})

describe('子 store 边界行为', () => {
  let m: StoresModule

  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    m = await import('../src/stores')
  })

  it('AI：删除当前服务商回落到剩下的第一个可用模型', () => {
    m.useAIConfigStore.getState().replaceAI({
      providers: [
        { id: 'p1', name: 'A', type: 'openai', baseUrl: 'https://a/v1', models: [{ id: 'm1', enabled: true, source: 'auto' }] },
        { id: 'p2', name: 'B', type: 'openai', baseUrl: 'https://b/v1', models: [{ id: 'm2', enabled: true, source: 'auto' }] },
      ],
      active: { providerId: 'p2', modelId: 'm2' },
      defaultTemperature: 0.7,
    })

    m.useAIConfigStore.getState().deleteProvider('p2')
    expect(m.useAIConfigStore.getState().ai.active).toEqual({ providerId: 'p1', modelId: 'm1' })

    // 删除/更新不存在的 id 是空操作
    m.useAIConfigStore.getState().deleteProvider('nope')
    m.useAIConfigStore.getState().updateProvider('nope', { name: 'x' })
    expect(m.useAIConfigStore.getState().ai.providers.map((p) => p.name)).toEqual(['A'])
  })

  it('AI：无服务商时当前配置为空视图', () => {
    m.useAIConfigStore.getState().resetAIConfig()
    expect(m.useAIConfigStore.getState().ai.providers).toEqual([])
    expect(m.useAIConfigStore.getState().getActiveProvider()).toBeUndefined()
    expect(m.useAIConfigStore.getState().aiConfig).toMatchObject({ apiUrl: '', model: '' })
  })

  it('处理历史：按文件名去重、最新在前、可本地清空', () => {
    const hist = m.useProcessingHistoryStore.getState()
    for (let i = 0; i < 12; i++) {
      hist.addRecord({
        bookTitle: `b${i}`,
        fileName: `f${i % 11}`,
        processingMode: 'summary',
        model: 'm',
        chapterCount: 1,
      })
    }
    const records = m.useProcessingHistoryStore.getState().records
    expect(records).toHaveLength(11)
    expect(records[0].bookTitle).toBe('b11')
    expect(records.filter((r) => r.fileName === 'f0')).toHaveLength(1)

    m.useProcessingHistoryStore.getState().clearLocalView()
    expect(m.useProcessingHistoryStore.getState().records).toEqual([])
  })

  it('处理历史：服务端历史最多保留 200 条', () => {
    const many = Array.from({ length: 260 }, (_, i) => ({
      bookTitle: `b${i}`,
      fileName: `f${i}.epub`,
      completedAt: new Date().toISOString(),
      processingMode: 'summary' as const,
      model: 'm',
      chapterCount: 1,
    }))
    m.useProcessingHistoryStore.getState().replaceHistory({ records: many })
    expect(m.useProcessingHistoryStore.getState().records).toHaveLength(200)

    m.useProcessingHistoryStore.getState().replaceHistory({ records: 'bad' as never })
    expect(m.useProcessingHistoryStore.getState().records).toEqual([])
  })
})
