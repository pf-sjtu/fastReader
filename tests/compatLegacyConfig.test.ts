/**
 * 旧版导出配置（2026-08，Web 端导出的 YAML）仍可导入
 * 样例由真实导出文件脱敏而来（逐行替换，保留未加引号的时间戳等原始写法），见 tests/fixtures/config/
 *
 * 说明：旧设计里的「提示词版本切换（v1/v2）」已移除——提示词 store 只存相对内置 v2 的覆盖项，
 * 因此本文件不再断言 currentPromptVersion / promptVersionConfig；迁移细节由
 * tests/aiProviderMigration.test.ts 覆盖，这里只验证「经兼容壳导入后落到各子 store」的端到端行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type StoresModule = typeof import('../src/stores')

const FIXTURE = resolve(__dirname, 'fixtures/config/legacy-export-2026-08.yaml')
const legacyYaml = () => readFileSync(FIXTURE, 'utf8')

/** 导入后会把各节写回服务端：这里用内存假 fetch，避免真实网络请求 */
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

async function boot(): Promise<StoresModule> {
  localStorage.clear()
  vi.resetModules()
  return import('../src/stores')
}

describe('旧版导出配置导入（兼容壳 → 子 store）', () => {
  let m: StoresModule

  beforeEach(async () => {
    stubSharedStateApi()
    m = await boot()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('导入成功，5 条模型折叠为 1 个服务商，当前模型为 glm-5.2', () => {
    expect(m.useConfigStore.getState().importConfig(legacyYaml())).toEqual({ success: true })

    const { ai, aiConfig } = m.useAIConfigStore.getState()
    expect(ai.providers).toHaveLength(1)
    expect(ai.providers[0].models.map((model) => model.id)).toEqual([
      'grok-4.5:online',
      'gpt-5.6-luna:online',
      'deepseek-v4-flash',
      'MiniMax-M3',
      'glm-5.2',
    ])
    expect(ai.active).toEqual({ providerId: ai.providers[0].id, modelId: 'glm-5.2' })
    expect(aiConfig.model).toBe('glm-5.2')
    expect(aiConfig.providerId).toBe(ai.providers[0].id)
    // 明文 key 不上客户端状态：只标记「已配置」，运行时视图里也没有 apiKey
    expect(ai.providers[0].apiKey).toEqual({ hasSecret: true })
    expect(JSON.stringify(ai)).not.toContain('sk-test-0000000000')
    expect(aiConfig.apiKey).toBeUndefined()
  })

  it('旧文件缺失的新字段按默认值补齐，已有字段原样保留', () => {
    m.useConfigStore.getState().importConfig(legacyYaml())

    const po = m.useProcessingStore.getState().processingOptions
    expect(po.chapterConcurrency).toBe(3) // 旧文件没有
    expect(po.chapterDetectionMode).toBe('epub-toc')
    expect(po.epubTocDepth).toBe(1)
    expect(po.bookType).toBe('non-fiction')
    expect(m.useProcessingStore.getState().exchangeRateUsdToCny).toBe(7)

    const dav = m.useWebDAVStore.getState().webdavConfig
    expect(dav.browsePath).toBe('/') // 旧文件没有
    expect(dav.syncPath).toBe('/fastReader')
    expect(dav.serverUrl).toBe('https://dav.example.com/dav/')
    expect(dav.autoSync).toBe(true)
    // 密码只标记存在，明文留在内存待提交
    expect(dav.password).toEqual({ hasSecret: true })
    expect(JSON.stringify(dav)).not.toContain('test-password')
  })

  it('WebDAV 连接状态是运行时状态：不随备份带入', () => {
    // 样例里记录的是导出设备上的 connectionStatus: error
    expect(legacyYaml()).toMatch(/connectionStatus: error/)
    m.useConfigStore.getState().importConfig(legacyYaml())
    expect(m.useWebDAVStore.getState().webdavConfig.connectionStatus).toBe('disconnected')
  })

  it('保留 v2 的「章节总结（非虚构）」覆盖项，其余提示词跟随内置默认', async () => {
    const { DEFAULT_PROMPT_CONFIG } = await import('../src/services/prompts/templates')
    m.useConfigStore.getState().importConfig(legacyYaml())

    const { overrides, promptConfig } = m.usePromptStore.getState()
    expect(Object.keys(overrides.chapterSummary ?? {})).toEqual(['nonFiction'])
    expect(promptConfig.chapterSummary.nonFiction.startsWith('# 角色')).toBe(true)
    // 未被覆盖的条目等于内置默认（旧文件 v1 的 mindmap.arrow 不会被误用）
    expect(overrides.mindmap).toBeUndefined()
    expect(promptConfig.mindmap).toEqual(DEFAULT_PROMPT_CONFIG.mindmap)
    expect(promptConfig.chapterSummary.fiction).toBe(DEFAULT_PROMPT_CONFIG.chapterSummary.fiction)
    expect(promptConfig.overallSummary).toBe(DEFAULT_PROMPT_CONFIG.overallSummary)
  })

  it('旧配置里保存的 v2 模板经当前 renderPrompt 渲染后无字面占位符、变量各出现一次', async () => {
    m.useConfigStore.getState().importConfig(legacyYaml())
    const { renderPrompt } = await import('../src/services/prompts/render')
    const tpl = m.usePromptStore.getState().promptConfig.chapterSummary.nonFiction

    const out = renderPrompt(tpl, [
      { name: 'title', label: '章节标题', value: '唯一标题ZXQ' },
      { name: 'content', label: '章节内容', value: '唯一正文ZXQ' },
    ])
    expect(out).not.toMatch(/\{\{/)
    expect(out.split('唯一标题ZXQ').length - 1).toBe(1)
    expect(out.split('唯一正文ZXQ').length - 1).toBe(1)
  })

  it('备份里的 tokenUsage 不导入（累计用量属于共享状态，只能通过 append 增长）', () => {
    const edited = legacyYaml().replace('tokenUsage: 0', 'tokenUsage: 12345')
    expect(edited).not.toBe(legacyYaml())
    expect(m.useConfigStore.getState().importConfig(edited)).toEqual({ success: true })
    expect(m.useUsageStore.getState().tokenUsage).toBe(0)
    expect(m.useUsageStore.getState().totalCostUSD).toBe(0)
  })

  it('导入后再导出，再次导入结果一致（可往返）', async () => {
    m.useConfigStore.getState().importConfig(legacyYaml())
    const exported = m.useConfigStore.getState().exportConfig()
    // 2.0.0 导出的默认不含明文密钥
    expect(exported).toContain('version: 2.0.0')
    expect(exported).not.toContain('sk-test-0000000000')
    expect(exported).not.toContain('test-password')

    const m2 = await boot()
    expect(m2.useConfigStore.getState().importConfig(exported)).toEqual({ success: true })
    const ai = m2.useAIConfigStore.getState().ai
    expect(ai.providers).toHaveLength(1)
    expect(ai.providers[0].models).toHaveLength(5)
    expect(ai.active.modelId).toBe('glm-5.2')
    expect(m2.usePromptStore.getState().overrides.chapterSummary?.nonFiction).toBe(
      m.usePromptStore.getState().overrides.chapterSummary?.nonFiction
    )
  })

  it('不兼容的版本号被明确拒绝，且不改动现有配置', () => {
    m.useConfigStore.getState().importConfig(legacyYaml())
    const before = m.useAIConfigStore.getState().ai.providers[0].models.length
    const res = m.useConfigStore
      .getState()
      .importConfig(legacyYaml().replace('version: 1.0.0', 'version: 9.9.9'))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/9\.9\.9/)
    expect(m.useAIConfigStore.getState().ai.providers).toHaveLength(1)
    expect(m.useAIConfigStore.getState().ai.providers[0].models).toHaveLength(before)
  })

  // 旧用例「customFields 写成 null 也能导入并归一化为对象」已无意义：
  // ProviderEntry 不再有 customFields 字段，迁移时直接忽略（见 stores/aiMigration.ts）。
})
