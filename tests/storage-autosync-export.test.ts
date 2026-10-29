/**
 * storage：autoSyncService 与 configExportService
 * webdavService / cloudCacheService 的网络方法用 spy 替身，其余为真实逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { autoSyncService } from '../src/services/autoSyncService'
import { webdavService } from '../src/services/webdavService'
import { cloudCacheService } from '../src/services/cloudCacheService'
import { ConfigExportService, validateImportPlan } from '../src/services/configExportService'
import { useConfigStore } from '../src/stores/configStore'
import { useAIConfigStore } from '../src/stores/ai-config'
import { usePromptStore } from '../src/stores/prompts'
import { useWebDAVStore } from '../src/stores/webdav'

const book = {
  title: '书',
  author: '作者',
  chapters: [
    { id: '1', title: '一', content: 'abc', summary: 'S1', processed: true },
    { id: '2', title: '二', content: 'de', processed: false }
  ],
  connections: 'C',
  overallSummary: 'O'
}

const ok = { success: true as const, data: true }

beforeEach(() => {
  useWebDAVStore.getState().resetWebDAVConfig()
  useWebDAVStore.getState().updateWebDAVConfig({
    enabled: true, autoSync: true, serverUrl: 'https://d/', username: 'u'
  })
  // 密码只暂存在内存，配置里只留 {hasSecret}
  useWebDAVStore.getState().setWebDAVPassword('p')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(webdavService, 'initialize').mockResolvedValue(ok)
})

afterEach(() => vi.restoreAllMocks())

describe('autoSyncService.syncSummary', () => {
  it('上传 MD 到 cloudCache 路径并更新同步时间；有图表时写 JSON', async () => {
    const up = vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    const charts = vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValue({ success: true, path: '/p.json' })
    expect(await autoSyncService.syncSummary({ ...book, charts: { a: 1 } }, 'b.epub')).toBe(true)
    expect(up.mock.calls[0][0]).toBe(cloudCacheService.getCacheFilePath('b.epub'))
    expect(String(up.mock.calls[0][1])).toContain('S1')
    expect(charts).toHaveBeenCalledOnce()
    expect(useConfigStore.getState().webdavConfig.lastSyncTime).not.toBeNull()
  })

  it('图表 JSON 失败不影响 MD 成功', async () => {
    vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValue({ success: false, error: 'x' })
    expect(await autoSyncService.syncSummary({ ...book, charts: {} }, 'b.epub', 'numbered')).toBe(true)
  })

  it('未启用 / 关闭 autoSync（非 force）→ false；force 时忽略 autoSync', async () => {
    const up = vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    useWebDAVStore.getState().setWebDAVAutoSync(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub', 'auto', { force: true })).toBe(true)
    useWebDAVStore.getState().setWebDAVEnabled(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub', 'auto', { force: true })).toBe(false)
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('初始化失败 / 上传失败 / 抛异常 → false', async () => {
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false, error: 'e' })
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    vi.spyOn(webdavService, 'uploadFile').mockResolvedValueOnce({ success: false, error: 'e' })
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    vi.mocked(webdavService.initialize).mockRejectedValueOnce(new Error('boom'))
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
  })
})

describe('autoSyncService.syncChartsJson', () => {
  it('参数校验', async () => {
    expect((await autoSyncService.syncChartsJson('b.epub', null)).error).toBe('无图表数据')
    expect((await autoSyncService.syncChartsJson('  ', {})).error).toBe('文件名为空')
    useWebDAVStore.getState().setWebDAVEnabled(false)
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('WebDAV 未启用')
  })

  it('成功、失败、初始化失败、异常', async () => {
    const charts = vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValueOnce({ success: true, path: '/p' })
    expect(await autoSyncService.syncChartsJson('b.epub', {})).toEqual({ success: true, path: '/p' })
    charts.mockResolvedValueOnce({ success: false, error: 'x' })
    expect((await autoSyncService.syncChartsJson('b.epub', {})).success).toBe(false)
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false })
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('WebDAV 初始化失败')
    charts.mockRejectedValueOnce(new Error('boom'))
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('boom')
  })
})

describe('autoSyncService.syncMindMap', () => {
  const mm = {
    title: 't', author: 'a',
    chapters: [{ id: '1', title: '一', content: '', mindMap: { n: 1 }, processed: true }, { id: '2', title: '二', content: '', processed: false }],
    combinedMindMap: { all: 1 }
  }

  it('未开启自动同步时跳过（返回 true）', async () => {
    useWebDAVStore.getState().setWebDAVAutoSync(false)
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(true)
  })

  it('同步章节与整书导图', async () => {
    const sync = vi.spyOn(webdavService, 'syncFiles').mockResolvedValueOnce(ok)
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(true)
    expect(sync.mock.calls[0][0].map((f) => f.path)).toEqual([
      'b/mindmaps/b_chapter_1_mindmap.json',
      'b/b_combined_mindmap.json'
    ])
    sync.mockResolvedValueOnce({ success: false, error: 'x' })
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false })
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
    sync.mockRejectedValueOnce(new Error('boom'))
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
  })
})

describe('ConfigExportService（2.0.0 服务商化导出）', () => {
  // 同一文件的用例共享模块状态：导出前把 AI / 提示词打回干净状态
  beforeEach(() => {
    useAIConfigStore.getState().resetAIConfig()
    usePromptStore.getState().resetAllPrompts()
  })

  /** 兼容壳当前聚合状态 → 导出源 */
  const exportSource = () => {
    const s = useConfigStore.getState()
    return {
      ai: s.ai,
      processingOptions: s.processingOptions,
      exchangeRateUsdToCny: s.exchangeRateUsdToCny,
      webdav: s.webdavConfig,
      prompts: s.promptOverrides,
      tokenUsage: s.tokenUsage,
    }
  }

  it('导出只含数据字段，默认不写明文密钥，导入回来的计划可通过校验', () => {
    useAIConfigStore.getState().addProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: { hasSecret: true },
      models: [{ id: 'gpt-4o', enabled: true, source: 'manual' }],
    })

    const yaml = ConfigExportService.exportConfig(exportSource(), {
      providerSecrets: { [useAIConfigStore.getState().ai.providers[0].id]: 'sk-live-123' },
    })
    expect(yaml).toContain('version: 2.0.0')
    expect(yaml).not.toContain('addProvider')
    // 默认走占位符，明文不出现在导出文件里
    expect(yaml).not.toContain('sk-live-123')
    expect(yaml).toContain('FASTREADER_PROVIDER_')

    const plan = ConfigExportService.importConfig(yaml)
    expect(plan.ai.providers).toHaveLength(useAIConfigStore.getState().ai.providers.length)
    expect(plan.ai.providers[0].models.map((m) => m.id)).toEqual(['gpt-4o'])
    expect(validateImportPlan(plan)).toEqual([])
  })

  it('includeSecrets 显式开启时才导出明文', () => {
    const providerId = useAIConfigStore.getState().addProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4o', enabled: true, source: 'manual' }],
    })
    const yaml = ConfigExportService.exportConfig(exportSource(), {
      includeSecrets: true,
      providerSecrets: { [providerId]: 'sk-live-123' },
      webdavPassword: 'p',
    })
    expect(yaml).toContain('sk-live-123')
    expect(yaml).toContain('p')
  })

  it('validateImportPlan 报告缺服务商与非法 baseUrl', () => {
    const plan = ConfigExportService.importConfig('version: 2.0.0\nexportTime: x\nconfig: {}\n')
    expect(validateImportPlan(plan)).toContain('配置中没有服务商')

    const bad = ConfigExportService.importConfig(
      [
        'version: 2.0.0',
        'exportTime: x',
        'config:',
        '  ai:',
        '    providers:',
        '      - id: p1',
        '        name: Bad',
        '        type: openai',
        '        baseUrl: ""',
        '        models: []',
        '    active: { providerId: p1, modelId: "" }',
        '',
      ].join('\n')
    )
    expect(validateImportPlan(bad)).toEqual(expect.arrayContaining(['服务商 Bad 缺少 baseUrl']))
  })

  it('导入格式错误 / 版本不兼容 / YAML 语法错误', () => {
    expect(() => ConfigExportService.importConfig('a: 1')).toThrow('配置文件格式无效')
    expect(() =>
      ConfigExportService.importConfig('version: "9.9.9"\nexportTime: x\nconfig: {a: 1}')
    ).toThrow('不兼容')
    expect(() => ConfigExportService.importConfig('a: [1, 2')).toThrow('配置导入失败')
  })

  it('preview 汇总服务商/模型/提示词覆盖项', () => {
    const providerId = useAIConfigStore.getState().addProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: { hasSecret: true },
      models: [
        { id: 'gpt-4o', enabled: true, source: 'manual' },
        { id: 'gpt-4o-mini', enabled: true, source: 'manual' },
      ],
    })
    usePromptStore.getState().setOverallSummaryPrompt('自定义总览')

    const plan = ConfigExportService.importConfig(ConfigExportService.exportConfig(exportSource()))
    const preview = ConfigExportService.preview(plan)
    expect(preview.version).toBe('2.0.0')
    expect(preview.providerCount).toBe(1)
    expect(preview.modelCount).toBe(2)
    expect(preview.providers[0]).toMatchObject({ baseUrl: 'https://api.openai.com/v1', models: 2 })
    expect(preview.promptOverrideKeys).toEqual(['overallSummary'])
    expect(preview.webdav.serverUrl).toBe('https://d/')
    expect(providerId).toBeTruthy()
  })

  it('文件名固定格式', () => {
    expect(ConfigExportService.generateFileName()).toMatch(/^ebook-to-mindmap-config-.*\.yaml$/)
  })
})
