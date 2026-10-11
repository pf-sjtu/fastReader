/**
 * storage：store 单一事实来源、老用户迁移、version/migrate、tokenUsage 不持久化
 * 每个用例 resetModules 后动态导入，模拟「带着某种 localStorage 启动页面」
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type StoresModule = typeof import('../src/stores')

async function boot(seed: Record<string, unknown> = {}): Promise<StoresModule> {
  localStorage.clear()
  for (const [k, v] of Object.entries(seed)) {
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }
  vi.resetModules()
  return import('../src/stores')
}

const read = (key: string) => {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

const legacyProviders = [
  { provider: 'openai', apiKey: 'sk-legacy-1', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o', temperature: 0.3 },
  { provider: 'custom', apiKey: 'sk-legacy-2', apiUrl: 'https://x.example/v1', model: 'm2', temperature: 0.5 }
]

function legacyState(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      aiConfigManager: { providers: legacyProviders, currentModelId: 2 },
      aiConfig: { provider: 'custom', apiKey: 'sk-legacy-2' },
      tokenUsage: 999,
      processingOptions: { processingMode: 'summary', bookType: 'fiction', outputLanguage: 'zh' },
      webdavConfig: { enabled: true, serverUrl: 'https://dav.example/dav/', username: 'u', password: 'pw-legacy', syncPath: '/fr' },
      promptVersionConfig: {
        v1: { chapterSummary: { fiction: 'L1', nonFiction: 'L1n' }, mindmap: { chapter: '', arrow: '', combined: '' }, connectionAnalysis: '', overallSummary: '' },
        v2: { chapterSummary: { fiction: 'L2', nonFiction: 'L2n' }, mindmap: { chapter: '', arrow: '', combined: '' }, connectionAnalysis: '', overallSummary: '' }
      },
      currentPromptVersion: 'v2',
      aiServiceOptions: { maxRetries: 7, baseRetryDelay: 1000 },
      ...overrides
    },
    version: 0
  }
}

describe('老用户迁移（只有 ebook-mindmap-config）', () => {
  it('子 store 获得旧数据，首次 setter 不会用默认值覆盖服务商', async () => {
    const m = await boot({ 'ebook-mindmap-config': legacyState() })

    const ai = m.useAIConfigStore.getState()
    expect(ai.aiConfigManager.providers.map((p) => p.apiKey)).toEqual(['sk-legacy-1', 'sk-legacy-2'])
    expect(ai.aiConfig.apiKey).toBe('sk-legacy-2')
    expect(m.useProcessingStore.getState().processingOptions.bookType).toBe('fiction')
    // 旧数据缺失字段用默认值补齐
    expect(m.useProcessingStore.getState().processingOptions.chapterConcurrency).toBe(3)
    expect(m.useWebDAVStore.getState().webdavConfig.password).toBe('pw-legacy')
    expect(m.useWebDAVStore.getState().webdavConfig.browsePath).toBe('/')
    expect(m.usePromptStore.getState().currentPromptVersion).toBe('v2')
    expect(m.usePromptStore.getState().promptConfig.chapterSummary.fiction).toBe('L2')
    expect(m.useCoreStore.getState().aiServiceOptions.maxRetries).toBe(7)
    // tokenUsage 不迁移
    expect(m.useCoreStore.getState().tokenUsage).toBe(0)

    // 首次 setter
    m.useConfigStore.getState().setApiKey('sk-new')
    const after = m.useConfigStore.getState().aiConfigManager.providers
    expect(after).toHaveLength(2)
    expect(after[0].apiKey).toBe('sk-legacy-1')
    expect(after[1].apiKey).toBe('sk-new')

    // 旧键被清理
    expect(localStorage.getItem('ebook-mindmap-config')).toBeNull()
  })

  it('再次启动不会重复迁移，数据来自子 store 键', async () => {
    await boot({ 'ebook-mindmap-config': legacyState() })
    const snapshot: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      snapshot[k] = localStorage.getItem(k)!
    }
    const m = await boot(snapshot)
    expect(m.useConfigStore.getState().aiConfigManager.providers[0].apiKey).toBe('sk-legacy-1')
    expect(m.useConfigStore.getState().webdavConfig.password).toBe('pw-legacy')
  })

  it('子 store 键已存在：提示词以子 store 为准，AI 服务商以旧键为准', async () => {
    const subPrompt = legacyState().state.promptVersionConfig
    const m = await boot({
      'ebook-mindmap-config': legacyState(),
      'ebook-prompt-config': {
        state: {
          promptVersionConfig: { ...subPrompt, v1: { ...subPrompt.v1, overallSummary: 'SUB' } },
          promptConfig: { ...subPrompt.v1, overallSummary: 'SUB' },
          currentPromptVersion: 'v1'
        },
        version: 0
      },
      // 旧 bug 留下的状态：子 store 只有默认服务商
      'ebook-ai-config': {
        state: { aiConfigManager: { providers: [{ provider: 'gemini', apiKey: '', apiUrl: '', model: 'g', temperature: 0.7 }], currentModelId: 1 } },
        version: 0
      }
    })
    expect(m.usePromptStore.getState().currentPromptVersion).toBe('v1')
    expect(m.usePromptStore.getState().promptConfig.overallSummary).toBe('SUB')
    expect(m.useAIConfigStore.getState().aiConfigManager.providers).toHaveLength(2)
    expect(read('ebook-ai-config').state.aiConfigManager.providers).toHaveLength(2)
  })

  it('旧键损坏时保持原样不抛错', async () => {
    const m = await boot({ 'ebook-mindmap-config': '{not json' })
    expect(localStorage.getItem('ebook-mindmap-config')).toBe('{not json')
    expect(m.useConfigStore.getState().aiConfigManager.providers.length).toBeGreaterThan(0)
  })

  it('migrateLegacyConfig：无 storage / 无旧键返回 false', async () => {
    const { migrateLegacyConfig } = await import('../src/stores/legacyMigration')
    expect(migrateLegacyConfig(null)).toBe(false)
    localStorage.clear()
    expect(migrateLegacyConfig(localStorage)).toBe(false)
  })
})

describe('单一事实来源', () => {
  let m: StoresModule
  beforeEach(async () => {
    m = await boot()
  })

  it('壳不再写 ebook-mindmap-config；密钥只出现在一个键里', () => {
    m.useConfigStore.getState().setApiKey('sk-unique-123')
    m.useConfigStore.getState().setWebDAVPassword('pw-unique-456')
    m.useConfigStore.getState().setBookType('fiction')

    expect(localStorage.getItem('ebook-mindmap-config')).toBeNull()
    const all = Object.keys(localStorage).map((k) => localStorage.getItem(k) || '')
    expect(all.filter((v) => v.includes('sk-unique-123'))).toHaveLength(1)
    expect(all.filter((v) => v.includes('pw-unique-456'))).toHaveLength(1)
    // aiConfig 是派生字段，不再持久化
    expect(read('ebook-ai-config').state.aiConfig).toBeUndefined()
    expect(read('ebook-ai-config').version).toBe(1)
  })

  it('setApiKey 同步更新 aiConfigManager（列表显示新值）', () => {
    m.useConfigStore.getState().setApiKey('k1')
    m.useConfigStore.getState().setModel('gpt-x')
    const s = m.useConfigStore.getState()
    expect(s.aiConfigManager.providers[0].apiKey).toBe('k1')
    expect(s.aiConfig.apiKey).toBe('k1')
    expect(s.aiConfig.model).toBe('gpt-x')
  })

  it('兼容 setter 作用于当前服务商（currentModelId 为 1-based）', () => {
    const st = m.useConfigStore.getState()
    st.addAIProvider({ provider: 'openai', apiKey: 'a', apiUrl: 'u', model: 'm', temperature: 0.1 })
    st.setCurrentModelId(2)
    st.setApiKey('second')
    st.setApiUrl('https://u2')
    st.setTemperature(0.9)
    st.setProxyUrl('http://p')
    st.setProxyEnabled(true)
    st.setAiProvider('302.ai')
    const providers = m.useConfigStore.getState().aiConfigManager.providers
    expect(providers[0].apiKey).toBe('')
    expect(providers[1]).toMatchObject({
      apiKey: 'second', apiUrl: 'https://u2', temperature: 0.9, proxyUrl: 'http://p', proxyEnabled: true, provider: '302.ai'
    })
  })

  it('直接改子 store，壳同步', () => {
    m.useWebDAVStore.getState().setWebDAVSyncPath('/x')
    m.usePromptStore.getState().setCurrentPromptVersion('v2')
    m.useCoreStore.getState().setMaxRetries(9)
    m.useProcessingStore.getState().setEpubTocDepth(3)
    const s = m.useConfigStore.getState()
    expect(s.webdavConfig.syncPath).toBe('/x')
    expect(s.currentPromptVersion).toBe('v2')
    expect(s.aiServiceOptions.maxRetries).toBe(9)
    expect(s.processingOptions.epubTocDepth).toBe(3)
  })

  it('壳 setter 全部转发到子 store', () => {
    const st = m.useConfigStore.getState()
    st.setProcessingMode('summary')
    st.setUseSmartDetection(true)
    st.setSkipNonEssentialChapters(false)
    st.setMaxSubChapterDepth(2)
    st.setOutputLanguage('zh')
    st.setChapterNamingMode('numbered')
    st.setEnableNotification(false)
    st.setChapterDetectionMode('epub-toc')
    st.setEpubTocDepth(2)
    st.setChapterConcurrency(5)
    st.setWebDAVEnabled(true)
    st.setWebDAVServerUrl('https://s/')
    st.setWebDAVUsername('u')
    st.setWebDAVAppName('a')
    st.setWebDAVAutoSync(true)
    st.setWebDAVSyncPath('/s')
    st.setWebDAVBrowsePath('/b')
    st.setWebDAVConnectionStatus('connected')
    st.updateWebDAVLastSyncTime()
    st.setChapterSummaryPrompt('fiction', 'F')
    st.setMindmapPrompt('chapter', 'C')
    st.setConnectionAnalysisPrompt('CA')
    st.setOverallSummaryPrompt('O')
    st.setMaxRetries(4)
    st.setBaseRetryDelay(10)
    const s = m.useConfigStore.getState()
    expect(s.processingOptions).toMatchObject({
      processingMode: 'summary', useSmartDetection: true, skipNonEssentialChapters: false, maxSubChapterDepth: 2,
      outputLanguage: 'zh', chapterNamingMode: 'numbered', enableNotification: false,
      chapterDetectionMode: 'epub-toc', epubTocDepth: 2, chapterConcurrency: 5
    })
    expect(s.webdavConfig).toMatchObject({
      enabled: true, serverUrl: 'https://s/', username: 'u', appName: 'a', autoSync: true,
      syncPath: '/s', browsePath: '/b', connectionStatus: 'connected'
    })
    expect(s.webdavConfig.lastSyncTime).not.toBeNull()
    expect(s.promptConfig.chapterSummary.fiction).toBe('F')
    expect(s.promptConfig.mindmap.chapter).toBe('C')
    expect(s.promptConfig.connectionAnalysis).toBe('CA')
    expect(s.promptConfig.overallSummary).toBe('O')
    expect(s.aiServiceOptions).toEqual({ maxRetries: 4, baseRetryDelay: 10 })

    st.resetPromptsToDefaultForVersion('v1')
    st.resetPromptsToDefault()
    st.resetWebDAVConfig()
    expect(m.useConfigStore.getState().webdavConfig.syncPath).toBe('/fastReader')
  })

  it('服务商管理方法转发', () => {
    const st = m.useConfigStore.getState()
    st.addProvider({ provider: 'openai', apiKey: 'a', apiUrl: 'u', model: 'm', temperature: 0.1 })
    st.duplicateProvider(2)
    st.createAIProviderFromTemplate('ollama')
    expect(m.useConfigStore.getState().aiConfigManager.providers).toHaveLength(4)
    st.updateProvider(4, { model: 'llama3' })
    expect(st.getProviderByIndex(4)?.model).toBe('llama3')
    expect(st.getActiveAIProvider()?.model).toBe('llama3')
    st.deleteProvider(4)
    expect(m.useConfigStore.getState().aiConfigManager.providers).toHaveLength(3)
    expect(st.getAvailableAITemplates().length).toBeGreaterThan(0)
  })

  it('导出 → 重置 → 导入 往返', () => {
    const st = m.useConfigStore.getState()
    st.setApiKey('exp-key')
    st.setBookType('fiction')
    const yaml = st.exportConfig()
    st.resetAllConfig()
    expect(m.useConfigStore.getState().aiConfig.apiKey).toBe('')
    const r = st.importConfig(yaml)
    expect(r).toEqual({ success: true })
    expect(m.useConfigStore.getState().aiConfig.apiKey).toBe('exp-key')
    expect(m.useConfigStore.getState().processingOptions.bookType).toBe('fiction')
    expect(st.importConfig('version: 9.9.9\nexportTime: x\nconfig: {}').success).toBe(false)
    expect(st.importConfig('version: "1.0.0"\nexportTime: x\nconfig: {}').success).toBe(false)
  })
})

describe('tokenUsage 不持久化', () => {
  it('计数在内存里，不写 localStorage；v0 遗留 tokenUsage 被丢弃', async () => {
    const m = await boot({
      'ebook-core-config': { state: { tokenUsage: 12345, aiServiceOptions: { maxRetries: 2 } }, version: 0 }
    })
    expect(m.useCoreStore.getState().tokenUsage).toBe(0)
    expect(m.useCoreStore.getState().aiServiceOptions).toEqual({ maxRetries: 2, baseRetryDelay: 60000 })
    const before = localStorage.getItem('ebook-core-config')
    m.useConfigStore.getState().addTokenUsage(100)
    m.useConfigStore.getState().addTokenUsage(20)
    expect(m.useConfigStore.getState().tokenUsage).toBe(120)
    expect(read('ebook-core-config').state.tokenUsage).toBeUndefined()
    expect(localStorage.getItem('ebook-core-config')).toBe(before)
    m.useConfigStore.getState().resetTokenUsage()
    expect(m.useConfigStore.getState().tokenUsage).toBe(0)
  })

  it('useTokenUsage 只在 tokenUsage 变化时重渲染', async () => {
    const m = await boot()
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let renders = 0
    let seen = -1
    function Probe() {
      renders++
      seen = m.useTokenUsage()
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(React.createElement(Probe)))
    const base = renders
    await act(async () => m.useConfigStore.getState().setBookType('fiction'))
    expect(renders).toBe(base)
    await act(async () => m.useConfigStore.getState().addTokenUsage(5))
    expect(seen).toBe(5)
    expect(renders).toBe(base + 1)
    await act(async () => root.unmount())
  })
})

describe('其他 persist store 的 version/migrate', () => {
  it('v0 数据可读，写回为 version 1', async () => {
    const m = await boot({
      'ebook-webdav-config': { state: { webdavConfig: { serverUrl: 'https://old/' } }, version: 0 },
      'ebook-processing-options': { state: { processingOptions: { bookType: 'fiction', chapterConcurrency: 99 } }, version: 0 },
      'ebook-processing-history': { state: { records: 'bad' }, version: 0 }
    })
    expect(m.useWebDAVStore.getState().webdavConfig).toMatchObject({ serverUrl: 'https://old/', syncPath: '/fastReader' })
    expect(m.useProcessingStore.getState().processingOptions).toMatchObject({ bookType: 'fiction', chapterConcurrency: 10 })
    expect(m.useProcessingHistoryStore.getState().records).toEqual([])
    expect(read('ebook-webdav-config').version).toBe(1)
    expect(read('ebook-processing-history').version).toBe(1)
  })
})

describe('子 store 边界行为', () => {
  it('AI：删除/切换/越界索引', async () => {
    const m = await boot()
    const ai = m.useAIConfigStore.getState()
    ai.addAIProvider({ provider: 'openai', apiKey: '2', apiUrl: 'u', model: 'm2', temperature: 0 })
    ai.addAIProvider({ provider: 'openai', apiKey: '3', apiUrl: 'u', model: 'm3', temperature: 0 })
    // 当前为 3，删除 1 → 当前前移为 2
    ai.deleteAIProvider(1)
    expect(m.useAIConfigStore.getState().aiConfigManager.currentModelId).toBe(2)
    // 删除当前项
    ai.deleteAIProvider(2)
    expect(m.useAIConfigStore.getState().aiConfigManager.currentModelId).toBe(1)
    ai.deleteAIProvider(9)
    ai.updateAIProvider(9, { model: 'x' })
    ai.setCurrentModelId(9)
    expect(ai.duplicateAIProvider(9)).toBe(-1)
    expect(ai.getAIProviderByIndex(9)).toBeUndefined()
    expect(ai.createAIProviderFromTemplate('nope' as never)).toBe(-1)
    ai.deleteAIProvider(1)
    expect(m.useAIConfigStore.getState().getActiveAIProvider()).toBeUndefined()
    expect(m.useAIConfigStore.getState().aiConfig.provider).toBe('gemini')
    ai.resetAIConfig()
    expect(m.useAIConfigStore.getState().aiConfigManager.providers).toHaveLength(1)
    expect(m.useAIConfigStore.getState().aiConfigManager.getAvailableTemplates().length).toBe(4)
  })

  it('AI：持久化数据无效时保持默认', async () => {
    const m = await boot({ 'ebook-ai-config': { state: { aiConfigManager: { providers: 'bad' } }, version: 1 } })
    expect(m.useAIConfigStore.getState().aiConfigManager.providers).toHaveLength(1)
  })

  it('处理历史：去重、上限、清空', async () => {
    const m = await boot()
    const hist = m.useProcessingHistoryStore.getState()
    for (let i = 0; i < 12; i++) {
      hist.addRecord({ bookTitle: `b${i}`, fileName: `f${i % 11}`, processingMode: 'summary', model: 'm', chapterCount: 1 })
    }
    const records = m.useProcessingHistoryStore.getState().records
    expect(records).toHaveLength(10)
    expect(records[0].bookTitle).toBe('b11')
    expect(records.filter((r) => r.fileName === 'f0')).toHaveLength(1)
    hist.clearHistory()
    expect(m.useProcessingHistoryStore.getState().records).toEqual([])
  })
})
