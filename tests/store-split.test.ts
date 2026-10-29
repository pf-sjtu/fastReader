/**
 * Store 拆分验证：各子 store 的职责边界，以及兼容壳（useConfigStore）是否如实镜像子 store。
 *
 * 新设计下所有状态都在服务端共享（Cloudflare KV），store 只做内存视图 + 防抖写回；
 * AI 配置以「服务商 → 多模型」组织，提示词只存相对内置默认的覆盖项。
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { useAIConfigStore, computeAIConfig, serializeAI } from '../src/stores/ai-config'
import { useProcessingStore, normalizeProcessingData } from '../src/stores/processing'
import { useWebDAVStore, defaultWebDAVConfig, hasWebDAVCredentials } from '../src/stores/webdav'
import { usePromptStore } from '../src/stores/prompts'
import { useUsageStore } from '../src/stores/usage'
import { useConfigStore } from '../src/stores/configStore'
import { createEmptyAIState } from '../src/stores/aiMigration'
import { DEFAULT_PROMPT_CONFIG } from '../src/services/prompts/templates'
import type { ProviderEntry } from '../src/types/ai'

const provider = (overrides: Partial<ProviderEntry> = {}): ProviderEntry => ({
  id: 'p-test',
  name: 'OpenAI',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  models: [{ id: 'gpt-4', enabled: true, source: 'manual' }],
  ...overrides,
})

describe('Store Split Verification', () => {
  beforeEach(() => {
    useAIConfigStore.getState().resetAIConfig()
    useProcessingStore.getState().resetProcessingOptions()
    useWebDAVStore.getState().resetWebDAVConfig()
    usePromptStore.getState().resetAllPrompts()
    useUsageStore.getState().resetTokenUsage()
  })

  describe('AI Config Store（服务商维度）', () => {
    it('addProvider 返回服务商 id，首个服务商自动成为当前模型', () => {
      const id = useAIConfigStore.getState().addProvider({
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o', enabled: true, source: 'manual' }],
      })

      const { ai, aiConfig, getProvider } = useAIConfigStore.getState()
      expect(ai.providers).toHaveLength(1)
      expect(getProvider(id)?.baseUrl).toBe('https://api.openai.com/v1')
      expect(ai.active).toEqual({ providerId: id, modelId: 'gpt-4o' })
      expect(aiConfig).toMatchObject({ providerId: id, model: 'gpt-4o' })
    })

    it('updateProvider 按 id 修改，不影响其他服务商', () => {
      useAIConfigStore.getState().replaceAI({
        providers: [provider(), provider({ id: 'p-2', name: 'Other', models: [] })],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.7,
      })

      useAIConfigStore.getState().updateProvider('p-2', { baseUrl: 'https://x.example/v1' })
      const { ai } = useAIConfigStore.getState()
      expect(ai.providers[0].baseUrl).toBe('https://api.openai.com/v1')
      expect(ai.providers[1].baseUrl).toBe('https://x.example/v1')
    })

    it('setActiveModel 切换当前模型（providerId + modelId）', () => {
      useAIConfigStore.getState().replaceAI({
        providers: [
          provider({ models: [{ id: 'gpt-4', enabled: true, source: 'auto' }, { id: 'gpt-4o', enabled: true, source: 'auto' }] }),
          provider({ id: 'p-gemini', name: 'Gemini', type: 'gemini', models: [{ id: 'gemini-2.5-flash', enabled: true, source: 'auto' }] }),
        ],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.7,
      })

      useAIConfigStore.getState().setActiveModel('p-gemini', 'gemini-2.5-flash')
      const { ai, aiConfig } = useAIConfigStore.getState()
      expect(ai.active).toEqual({ providerId: 'p-gemini', modelId: 'gemini-2.5-flash' })
      expect(aiConfig.provider).toBe('gemini')
      expect(aiConfig.model).toBe('gemini-2.5-flash')

      // 同一服务商内换模型
      useAIConfigStore.getState().setActiveModel('p-test', 'gpt-4o')
      expect(useAIConfigStore.getState().aiConfig.model).toBe('gpt-4o')
    })

    it('deleteProvider 回落到剩下的第一个可用模型', () => {
      useAIConfigStore.getState().replaceAI({
        providers: [provider(), provider({ id: 'p-2', models: [{ id: 'm2', enabled: true, source: 'auto' }] })],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.7,
      })

      useAIConfigStore.getState().deleteProvider('p-test')
      const { ai, aiConfig } = useAIConfigStore.getState()
      expect(ai.providers.map((p) => p.id)).toEqual(['p-2'])
      expect(ai.active).toEqual({ providerId: 'p-2', modelId: 'm2' })
      expect(aiConfig.providerId).toBe('p-2')
    })

    it('密钥只标记 hasSecret，明文只在 serializeAI 的写回载荷里出现', () => {
      useAIConfigStore.getState().replaceAI({
        providers: [provider()],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.7,
      })

      useAIConfigStore.getState().setProviderSecret('p-test', 'sk-live-123')
      const { ai, aiConfig } = useAIConfigStore.getState()
      expect(ai.providers[0].apiKey).toEqual({ hasSecret: true })
      expect(JSON.stringify(ai)).not.toContain('sk-live-123')
      // 运行时视图永远不带 apiKey
      expect(aiConfig.apiKey).toBeUndefined()
      // 写回载荷才叠加明文，供服务端落库
      expect(JSON.stringify(serializeAI(useAIConfigStore.getState().ai))).toContain('sk-live-123')

      useAIConfigStore.getState().setProviderSecret('p-test', null)
      expect(useAIConfigStore.getState().ai.providers[0].apiKey).toBeUndefined()
      expect(JSON.stringify(serializeAI(useAIConfigStore.getState().ai))).not.toContain('sk-live-123')
    })

    it('模型级开关/温度/手填模型', () => {
      useAIConfigStore.getState().replaceAI({
        providers: [provider({ models: [{ id: 'gpt-4', enabled: true, source: 'auto' }] })],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.7,
      })

      useAIConfigStore.getState().setModelEnabled('p-test', 'gpt-4', false)
      expect(useAIConfigStore.getState().ai.providers[0].models[0].enabled).toBe(false)

      useAIConfigStore.getState().setModelTemperature('p-test', 'gpt-4', 0.2)
      expect(useAIConfigStore.getState().ai.providers[0].models[0].temperature).toBe(0.2)
      // 模型温度覆盖全局默认
      expect(useAIConfigStore.getState().aiConfig.temperature).toBe(0.2)
      // 清除覆盖后回落默认
      useAIConfigStore.getState().setModelTemperature('p-test', 'gpt-4', undefined)
      expect(useAIConfigStore.getState().aiConfig.temperature).toBe(0.7)

      useAIConfigStore.getState().addManualModel('p-test', 'my-model')
      expect(useAIConfigStore.getState().ai.providers[0].models.map((m) => m.id)).toEqual(['gpt-4', 'my-model'])
      expect(useAIConfigStore.getState().ai.providers[0].models[1].source).toBe('manual')

      useAIConfigStore.getState().removeModel('p-test', 'gpt-4')
      expect(useAIConfigStore.getState().ai.providers[0].models.map((m) => m.id)).toEqual(['my-model'])
      // 当前模型被删 → 回落到可用模型
      expect(useAIConfigStore.getState().ai.active.modelId).toBe('my-model')
    })

    it('computeAIConfig 从 AIState 派生扁平运行时视图', () => {
      expect(computeAIConfig(createEmptyAIState())).toMatchObject({ apiUrl: '', model: '' })

      const config = computeAIConfig({
        providers: [provider({ apiKey: { hasSecret: true } })],
        active: { providerId: 'p-test', modelId: 'gpt-4' },
        defaultTemperature: 0.3,
      })
      expect(config).toMatchObject({
        provider: 'openai',
        providerId: 'p-test',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4',
        temperature: 0.3,
      })
      expect(config.apiKey).toBeUndefined()
    })
  })

  describe('Processing Store（处理选项 + 汇率 + AI 重试）', () => {
    it('更新处理模式与书类型', () => {
      useProcessingStore.getState().setProcessingMode('summary')
      useProcessingStore.getState().setBookType('fiction')

      const { processingOptions } = useProcessingStore.getState()
      expect(processingOptions.processingMode).toBe('summary')
      expect(processingOptions.bookType).toBe('fiction')
    })

    it('汇率与 AI 重试参数同属 processing 节', () => {
      useProcessingStore.getState().setExchangeRateUsdToCny(7.3)
      useProcessingStore.getState().setMaxRetries(5)
      useProcessingStore.getState().setBaseRetryDelay(1000)

      const state = useProcessingStore.getState()
      expect(state.exchangeRateUsdToCny).toBe(7.3)
      expect(state.aiServiceOptions).toEqual({ maxRetries: 5, baseRetryDelay: 1000 })
      // 改处理选项不会把汇率重置回默认
      state.setBookType('fiction')
      expect(useProcessingStore.getState().exchangeRateUsdToCny).toBe(7.3)
    })

    it('章节并行上限夹紧到 1–10，非法汇率回落默认', () => {
      useProcessingStore.getState().setChapterConcurrency(99)
      expect(useProcessingStore.getState().processingOptions.chapterConcurrency).toBe(10)
      useProcessingStore.getState().setChapterConcurrency(-5)
      expect(useProcessingStore.getState().processingOptions.chapterConcurrency).toBe(1)
      // 0 视为「未设置」，回落到默认 3
      useProcessingStore.getState().setChapterConcurrency(0)
      expect(useProcessingStore.getState().processingOptions.chapterConcurrency).toBe(3)

      expect(normalizeProcessingData({ exchangeRateUsdToCny: -1 }).exchangeRateUsdToCny).toBe(7)
      expect(normalizeProcessingData({ exchangeRateUsdToCny: Number.NaN }).exchangeRateUsdToCny).toBe(7)
    })
  })

  describe('WebDAV Store', () => {
    it('更新服务地址与开关', () => {
      const store = useWebDAVStore.getState()
      store.setWebDAVEnabled(true)
      store.setWebDAVServerUrl('https://example.com/dav')
      store.setWebDAVUsername('u')

      const config = useWebDAVStore.getState().webdavConfig
      expect(config.enabled).toBe(true)
      expect(config.serverUrl).toBe('https://example.com/dav')
      expect(config.username).toBe('u')
    })

    it('密码只暂存待提交值，配置里只留 {hasSecret}', () => {
      useWebDAVStore.getState().setWebDAVPassword('secret-pw')
      const config = useWebDAVStore.getState().webdavConfig
      expect(config.password).toEqual({ hasSecret: true })
      expect(JSON.stringify(config)).not.toContain('secret-pw')

      expect(hasWebDAVCredentials({ ...config, serverUrl: 'https://dav/', username: 'u' })).toBe(true)

      useWebDAVStore.getState().setWebDAVPassword(null)
      expect(useWebDAVStore.getState().webdavConfig.password).toBeUndefined()
      expect(hasWebDAVCredentials({ ...defaultWebDAVConfig, serverUrl: 'https://dav/', username: 'u' })).toBe(false)
    })

    it('连接状态与最后同步时间只改内存', () => {
      useWebDAVStore.getState().setWebDAVConnectionStatus('connected')
      expect(useWebDAVStore.getState().webdavConfig.connectionStatus).toBe('connected')
      expect(useWebDAVStore.getState().webdavConfig.lastSyncTime).toBeNull()

      useWebDAVStore.getState().updateWebDAVLastSyncTime()
      expect(useWebDAVStore.getState().webdavConfig.lastSyncTime).not.toBeNull()
    })
  })

  describe('Prompt Store（覆盖项）', () => {
    it('与默认值相同不产生覆盖项，不同的才记录', () => {
      usePromptStore.getState().setChapterSummaryPrompt(
        'non-fiction',
        DEFAULT_PROMPT_CONFIG.chapterSummary.nonFiction
      )
      // 生效内容仍是默认，说明没有写覆盖项
      expect(usePromptStore.getState().promptConfig).toEqual(DEFAULT_PROMPT_CONFIG)

      usePromptStore.getState().setChapterSummaryPrompt('non-fiction', '自定义模板')
      expect(usePromptStore.getState().overrides.chapterSummary).toEqual({ nonFiction: '自定义模板' })
      expect(usePromptStore.getState().promptConfig.chapterSummary.nonFiction).toBe('自定义模板')
      // 未覆盖的条目继续跟随内置默认
      expect(usePromptStore.getState().promptConfig.chapterSummary.fiction).toBe(
        DEFAULT_PROMPT_CONFIG.chapterSummary.fiction
      )
    })

    it('resetPrompt 只清一条，resetAllPrompts 清空全部', () => {
      const store = usePromptStore.getState()
      store.setMindmapPrompt('chapter', 'C')
      store.setOverallSummaryPrompt('O')
      store.resetPrompt({ group: 'mindmap', key: 'chapter' })
      expect(usePromptStore.getState().overrides.mindmap?.chapter).toBeUndefined()
      expect(usePromptStore.getState().promptConfig.mindmap).toEqual(DEFAULT_PROMPT_CONFIG.mindmap)
      expect(usePromptStore.getState().overrides.overallSummary).toBe('O')

      usePromptStore.getState().resetAllPrompts()
      expect(usePromptStore.getState().overrides).toEqual({})
      expect(usePromptStore.getState().promptConfig).toEqual(DEFAULT_PROMPT_CONFIG)
    })
  })

  describe('Usage Store（共享累计用量）', () => {
    it('token 与费用累加，按模型分桶', () => {
      const store = useUsageStore.getState()
      store.addTokenUsage(100, 0.1, 'gpt-4')
      store.addTokenUsage(50, 0.05, 'gpt-4')
      store.addTokenUsage(10, 0.01, 'gemini')

      const state = useUsageStore.getState()
      expect(state.tokenUsage).toBe(160)
      expect(state.totalCostUSD).toBeCloseTo(0.16)
      expect(state.byModel['gpt-4']).toEqual({ tokens: 150, costUSD: expect.closeTo(0.15) })
      expect(state.byModel.gemini).toEqual({ tokens: 10, costUSD: expect.closeTo(0.01) })
    })

    it('resetTokenUsage 只清本地视图', () => {
      useUsageStore.getState().addTokenUsage(10, 0.01)
      useUsageStore.getState().resetTokenUsage()
      expect(useUsageStore.getState().tokenUsage).toBe(0)
      expect(useUsageStore.getState().byModel).toEqual({})
    })
  })

  describe('兼容壳 useConfigStore', () => {
    it('暴露新接口与聚合状态', () => {
      const shell = useConfigStore.getState()

      expect(shell.ai).toBeDefined()
      expect(shell.aiConfig).toBeDefined()
      expect(shell.processingOptions).toBeDefined()
      expect(shell.exchangeRateUsdToCny).toBe(7)
      expect(shell.webdavConfig).toBeDefined()
      expect(shell.promptConfig).toBeDefined()
      expect(shell.promptOverrides).toBeDefined()
      expect(typeof shell.tokenUsage).toBe('number')

      expect(typeof shell.getActiveAIProvider).toBe('function')
      expect(typeof shell.setProcessingMode).toBe('function')
      expect(typeof shell.setWebDAVEnabled).toBe('function')
      expect(typeof shell.setExchangeRateUsdToCny).toBe('function')
      expect(typeof shell.addTokenUsage).toBe('function')
      expect(typeof shell.exportConfig).toBe('function')
      expect(typeof shell.importConfig).toBe('function')
      expect(typeof shell.previewImport).toBe('function')
      expect(typeof shell.applyImportPlan).toBe('function')
    })

    it('直接改子 store，壳自动同步', () => {
      useWebDAVStore.getState().setWebDAVSyncPath('/x')
      usePromptStore.getState().setOverallSummaryPrompt('O')
      useProcessingStore.getState().setEpubTocDepth(3)
      useProcessingStore.getState().setMaxRetries(9)
      useAIConfigStore.getState().addProvider({
        name: 'Ollama',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        models: [{ id: 'llama3', enabled: true, source: 'manual' }],
      })

      const shell = useConfigStore.getState()
      expect(shell.webdavConfig.syncPath).toBe('/x')
      expect(shell.promptOverrides.overallSummary).toBe('O')
      expect(shell.processingOptions.epubTocDepth).toBe(3)
      expect(shell.aiServiceOptions.maxRetries).toBe(9)
      expect(shell.ai.providers).toHaveLength(1)
      expect(shell.aiConfig.model).toBe('llama3')
    })

    it('壳的 setter 全部转发到子 store', () => {
      const shell = useConfigStore.getState()
      shell.setProcessingMode('summary')
      shell.setBookType('fiction')
      shell.setChapterConcurrency(5)
      shell.setExchangeRateUsdToCny(7.5)
      shell.setWebDAVEnabled(true)
      shell.setWebDAVPassword('pw')
      shell.setConnectionAnalysisPrompt('CA')
      shell.addTokenUsage(7, 0.02)

      expect(useProcessingStore.getState().processingOptions).toMatchObject({
        processingMode: 'summary',
        bookType: 'fiction',
        chapterConcurrency: 5,
      })
      expect(useProcessingStore.getState().exchangeRateUsdToCny).toBe(7.5)
      expect(useWebDAVStore.getState().webdavConfig).toMatchObject({ enabled: true, password: { hasSecret: true } })
      expect(usePromptStore.getState().overrides.connectionAnalysis).toBe('CA')
      expect(useUsageStore.getState().tokenUsage).toBe(7)
    })

    it('getActiveAIProvider 返回当前运行时配置（无明文凭据）', () => {
      useAIConfigStore.getState().addProvider({
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: { hasSecret: true },
        models: [{ id: 'gpt-4o', enabled: true, source: 'manual' }],
      })

      const active = useConfigStore.getState().getActiveAIProvider()
      expect(active).toMatchObject({ provider: 'openai', model: 'gpt-4o' })
      expect(active?.apiKey).toBeUndefined()
    })

    it('resetAllConfig 把各子 store 打回默认', () => {
      useProcessingStore.getState().setBookType('fiction')
      useWebDAVStore.getState().setWebDAVSyncPath('/x')
      usePromptStore.getState().setOverallSummaryPrompt('O')
      useUsageStore.getState().addTokenUsage(10, 0.01)
      useAIConfigStore.getState().addProvider({
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: [],
      })

      useConfigStore.getState().resetAllConfig()

      const shell = useConfigStore.getState()
      expect(shell.processingOptions.bookType).toBe('non-fiction')
      expect(shell.webdavConfig.syncPath).toBe(defaultWebDAVConfig.syncPath)
      expect(shell.promptOverrides).toEqual({})
      expect(shell.tokenUsage).toBe(0)
      expect(shell.ai.providers).toEqual([])
    })
  })
})
