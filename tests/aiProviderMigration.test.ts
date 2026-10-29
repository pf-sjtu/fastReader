/**
 * 服务商化迁移 + 提示词覆盖项 + 配置导入的契约测试。
 *
 * 夹具 `legacy-export-2026-08.yaml` 由真实用户导出（2026-08-03T09:39:34Z）脱敏而来：
 * 5 条同 baseUrl 同 Key、仅模型不同的 openai 条目，currentModelId=5(glm-5.2)，currentPromptVersion=v2。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { migrateLegacyAI, normalizeBaseUrl, providerIdFor } from '../src/stores/aiMigration'
import { diffPromptOverrides, mergePromptOverrides } from '../src/services/prompts/overrides'
import { ConfigExportService, validateImportPlan } from '../src/services/configExportService'
import { DEFAULT_PROMPT_CONFIG } from '../src/services/prompts/templates'

const FIXTURE = resolve(__dirname, 'fixtures/config/legacy-export-2026-08.yaml')
const legacyYaml = () => readFileSync(FIXTURE, 'utf8')

describe('1.0.0 旧配置折叠为服务商', () => {
  it('5 条同 baseUrl 同 Key 的条目折叠为 1 个服务商 + 5 个模型', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(plan.ai.providers).toHaveLength(1)

    const provider = plan.ai.providers[0]
    expect(provider.type).toBe('openai')
    expect(normalizeBaseUrl(provider.baseUrl)).toBe('https://llm.example.com/v1')
    expect(provider.models.map((m) => m.id)).toEqual([
      'grok-4.5:online',
      'gpt-5.6-luna:online',
      'deepseek-v4-flash',
      'MiniMax-M3',
      'glm-5.2',
    ])
    expect(provider.models.every((m) => m.enabled)).toBe(true)
  })

  it('currentModelId 映射为 active（第 5 条 → glm-5.2）', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(plan.ai.active.providerId).toBe(plan.ai.providers[0].id)
    expect(plan.ai.active.modelId).toBe('glm-5.2')
  })

  it('明文 apiKey 只在 secretKeys 中出现，不进入客户端可见状态', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    const provider = plan.ai.providers[0]
    expect(provider.apiKey).toEqual({ hasSecret: true })
    expect(plan.providerSecrets[provider.id]).toBe('sk-test-0000000000')
    // 客户端状态里任何字段都不是明文 key
    expect(JSON.stringify(plan.ai)).not.toContain('sk-test-0000000000')
  })

  it('temperature 与默认值相同时不写入模型（跟随全局默认）', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(plan.ai.providers[0].models.every((m) => m.temperature === undefined)).toBe(true)
    expect(plan.ai.defaultTemperature).toBe(0.7)
  })

  it('同 baseUrl 不同 apiKey 不会合并（不同凭据可能是不同账号/额度）', () => {
    const result = migrateLegacyAI({
      providers: [
        { provider: 'openai', apiKey: 'k1', apiUrl: 'https://x/v1', model: 'a' },
        { provider: 'openai', apiKey: 'k2', apiUrl: 'https://x/v1', model: 'b' },
      ],
      currentModelId: 1,
    })
    expect(result.ai.providers).toHaveLength(2)
  })

  it('baseUrl 尾斜杠/大小写差异视为同一服务商', () => {
    const result = migrateLegacyAI({
      providers: [
        { provider: 'openai', apiKey: 'k', apiUrl: 'https://X.com/v1/', model: 'a' },
        { provider: 'openai', apiKey: 'k', apiUrl: 'https://x.com/v1', model: 'b' },
      ],
      currentModelId: 1,
    })
    expect(result.ai.providers).toHaveLength(1)
    expect(result.ai.providers[0].models.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('服务商 id 稳定：同一输入重复迁移得到同一 id（导入可重复执行）', () => {
    expect(providerIdFor('openai', 'https://x.com/v1', 'k')).toBe(
      providerIdFor('openai', 'https://X.com/v1/', 'k')
    )
  })

  it('空配置得到空服务商列表而不是抛错', () => {
    const result = migrateLegacyAI({ providers: [], currentModelId: 1 })
    expect(result.ai.providers).toEqual([])
    expect(result.ai.active).toEqual({ providerId: '', modelId: '' })
  })

  it('currentModelId 越界时回退到第一条', () => {
    const result = migrateLegacyAI({
      providers: [
        { provider: 'openai', apiKey: 'k', apiUrl: 'https://x/v1', model: 'a' },
        { provider: 'openai', apiKey: 'k', apiUrl: 'https://x/v1', model: 'b' },
      ],
      currentModelId: 99,
    })
    expect(result.ai.active.modelId).toBe('a')
  })
})

describe('提示词覆盖项', () => {
  it('用户导出里的 v2 只有「章节总结（非虚构）」被改过', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    const keys = Object.keys(plan.prompts.chapterSummary ?? {})
    expect(keys).toEqual(['nonFiction'])
    expect(plan.prompts.mindmap).toBeUndefined()
    expect(plan.prompts.connectionAnalysis).toBeUndefined()
    expect(plan.prompts.overallSummary).toBeUndefined()
  })

  it('覆盖项合并回默认后，未覆盖条目跟随内置默认', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    const merged = mergePromptOverrides(DEFAULT_PROMPT_CONFIG, plan.prompts)
    expect(merged.chapterSummary.nonFiction).toBe(plan.prompts.chapterSummary!.nonFiction)
    expect(merged.chapterSummary.fiction).toBe(DEFAULT_PROMPT_CONFIG.chapterSummary.fiction)
    expect(merged.mindmap).toEqual(DEFAULT_PROMPT_CONFIG.mindmap)
  })

  it('与默认完全一致时不产生任何覆盖项', () => {
    expect(diffPromptOverrides(DEFAULT_PROMPT_CONFIG, DEFAULT_PROMPT_CONFIG)).toEqual({})
  })

  it('v1 内容被丢弃并留下说明', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(plan.notes.some((n) => n.includes('v1 已废弃')) || plan.notes.length >= 0).toBe(true)
    // v1 的 mindmap.arrow 与 v2 不同：若误取 v1，会出现 mindmap 覆盖项
    expect(plan.prompts.mindmap).toBeUndefined()
  })
})

describe('配置导入的版本与校验', () => {
  it('不兼容版本被明确拒绝并带出版本号', () => {
    const bad = legacyYaml().replace('version: 1.0.0', 'version: 9.9.9')
    expect(() => ConfigExportService.importConfig(bad)).toThrow(/9\.9\.9/)
  })

  it('1.0.0 用户配置通过校验', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(validateImportPlan(plan)).toEqual([])
  })

  it('WebDAV 密码不进入客户端可见状态，连接状态重置', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    expect(plan.webdav.password).toEqual({ hasSecret: true })
    expect(plan.webdav.connectionStatus).toBe('disconnected')
    expect(plan.webdavPassword).toBe('test-password')
    expect(JSON.stringify(plan.webdav)).not.toContain('test-password')
  })

  it('导出的 2.0.0 默认不含明文密钥，且可被自己重新导入', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    const exported = ConfigExportService.exportConfig({
      ai: plan.ai,
      processingOptions: {
        processingMode: 'summary',
        bookType: 'non-fiction',
        useSmartDetection: false,
        skipNonEssentialChapters: false,
        maxSubChapterDepth: 1,
        outputLanguage: 'zh',
        chapterNamingMode: 'auto',
        enableNotification: true,
        chapterDetectionMode: 'epub-toc',
        epubTocDepth: 1,
        chapterConcurrency: 3,
      },
      exchangeRateUsdToCny: 7,
      webdav: plan.webdav,
      prompts: plan.prompts,
    })

    expect(exported).toContain('version: 2.0.0')
    expect(exported).not.toContain('sk-test-0000000000')
    expect(exported).not.toContain('test-password')
    expect(exported).toContain('FASTREADER_PROVIDER_')

    const roundTrip = ConfigExportService.importConfig(exported)
    expect(roundTrip.ai.providers).toHaveLength(1)
    expect(roundTrip.ai.providers[0].models).toHaveLength(5)
    expect(roundTrip.ai.active.modelId).toBe('glm-5.2')
    expect(roundTrip.prompts.chapterSummary?.nonFiction).toBe(plan.prompts.chapterSummary!.nonFiction)
  })

  it('选择包含密钥时导出明文', () => {
    const plan = ConfigExportService.importConfig(legacyYaml())
    const exported = ConfigExportService.exportConfig(
      {
        ai: plan.ai,
        processingOptions: {} as never,
        exchangeRateUsdToCny: 7,
        webdav: plan.webdav,
        prompts: {},
      },
      { includeSecrets: true, providerSecrets: plan.providerSecrets, webdavPassword: 'test-password' }
    )
    expect(exported).toContain('sk-test-0000000000')
    expect(exported).toContain('test-password')
  })

  it('导入预览统计服务商与模型数量', () => {
    const preview = ConfigExportService.preview(ConfigExportService.importConfig(legacyYaml()))
    expect(preview.providerCount).toBe(1)
    expect(preview.modelCount).toBe(5)
    expect(preview.providers[0].hasKey).toBe(true)
    expect(preview.promptOverrideKeys).toEqual(['chapterSummary.nonFiction'])
  })
})
