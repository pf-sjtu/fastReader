/**
 * 旧版导出配置（2026-08，Web 端导出的 YAML）仍可导入
 * 样例由真实导出文件脱敏而来（逐行替换，保留未加引号的时间戳等原始写法），见 tests/fixtures/config/
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type StoresModule = typeof import('../src/stores')

const FIXTURE = resolve(__dirname, 'fixtures/config/legacy-export-2026-08.yaml')
const legacyYaml = () => readFileSync(FIXTURE, 'utf8')

async function boot(): Promise<StoresModule> {
  localStorage.clear()
  vi.resetModules()
  return import('../src/stores')
}

describe('默认 prompt 版本', () => {
  it('新用户（空 localStorage）默认 v2，且当前模板内容确为 v2', async () => {
    const m = await boot()
    const pr = m.usePromptStore.getState()
    expect(pr.currentPromptVersion).toBe('v2')
    expect(pr.promptConfig).toEqual(pr.promptVersionConfig.v2)
    expect(pr.promptConfig).not.toEqual(pr.promptVersionConfig.v1)
  })

  it('已持久化为 v1 的用户保持 v1，不被默认值悄悄改掉', async () => {
    localStorage.clear()
    const seed = await boot()
    const v1 = seed.usePromptStore.getState().promptVersionConfig.v1
    localStorage.setItem(
      'ebook-prompt-config',
      JSON.stringify({
        state: {
          promptConfig: v1,
          promptVersionConfig: seed.usePromptStore.getState().promptVersionConfig,
          currentPromptVersion: 'v1',
        },
        version: 1,
      })
    )
    vi.resetModules()
    const m = await import('../src/stores')
    expect(m.usePromptStore.getState().currentPromptVersion).toBe('v1')
    expect(m.usePromptStore.getState().promptConfig).toEqual(v1)
  })

  it('重置全部配置回到默认 v2', async () => {
    const m = await boot()
    m.usePromptStore.getState().setCurrentPromptVersion('v1')
    m.useConfigStore.getState().resetAllConfig()
    const pr = m.usePromptStore.getState()
    expect(pr.currentPromptVersion).toBe('v2')
    expect(pr.promptConfig).toEqual(pr.promptVersionConfig.v2)
  })
})

describe('旧版导出配置导入', () => {
  let m: StoresModule

  beforeEach(async () => {
    m = await boot()
  })

  it('导入成功，服务商与当前模型（1-based 末位）完整保留', () => {
    const res = m.useConfigStore.getState().importConfig(legacyYaml())
    expect(res).toEqual({ success: true })

    const { aiConfigManager, aiConfig } = m.useAIConfigStore.getState()
    expect(aiConfigManager.providers.map((p) => p.model)).toEqual([
      'grok-4.5:online',
      'gpt-5.6-luna:online',
      'deepseek-v4-flash',
      'MiniMax-M3',
      'glm-5.2',
    ])
    expect(aiConfigManager.currentModelId).toBe(5)
    expect(aiConfig.model).toBe('glm-5.2')
    expect(aiConfig.apiKey).toBe('sk-test-0000000000')
    expect(aiConfigManager.providers.every((p) => p.customFields && typeof p.customFields === 'object')).toBe(true)
  })

  it('旧文件缺失的新字段按默认值补齐，已有字段原样保留', () => {
    m.useConfigStore.getState().importConfig(legacyYaml())

    const po = m.useProcessingStore.getState().processingOptions
    expect(po.chapterConcurrency).toBe(3) // 旧文件没有
    expect(po.chapterDetectionMode).toBe('epub-toc')
    expect(po.epubTocDepth).toBe(1)
    expect(po.bookType).toBe('non-fiction')

    const dav = m.useWebDAVStore.getState().webdavConfig
    expect(dav.browsePath).toBe('/') // 旧文件没有
    expect(dav.syncPath).toBe('/fastReader')
    expect(dav.serverUrl).toBe('https://dav.example.com/dav/')
    expect(dav.autoSync).toBe(true)
  })

  it('WebDAV 连接状态是运行时状态：不随备份带入', () => {
    // 样例里记录的是导出设备上的 connectionStatus: error
    expect(legacyYaml()).toMatch(/connectionStatus: error/)
    m.useConfigStore.getState().importConfig(legacyYaml())
    expect(m.useWebDAVStore.getState().webdavConfig.connectionStatus).toBe('disconnected')
  })

  it('保留旧文件显式选择的 prompt 版本（v2）及其自定义模板，tokenUsage 不导入', () => {
    m.useConfigStore.getState().importConfig(legacyYaml())

    const pr = m.usePromptStore.getState()
    expect(pr.currentPromptVersion).toBe('v2')
    expect(pr.promptConfig.chapterSummary.nonFiction.startsWith('# 角色')).toBe(true)
    expect(Object.keys(pr.promptVersionConfig).sort()).toEqual(['v1', 'v2'])
    expect(m.useCoreStore.getState().tokenUsage).toBe(0)
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

  it('导入后再导出，再次导入结果一致（可往返）', async () => {
    m.useConfigStore.getState().importConfig(legacyYaml())
    const exported = m.useConfigStore.getState().exportConfig()

    const m2 = await boot()
    expect(m2.useConfigStore.getState().importConfig(exported)).toEqual({ success: true })
    const ai = m2.useAIConfigStore.getState().aiConfigManager
    expect(ai.providers).toHaveLength(5)
    expect(ai.currentModelId).toBe(5)
    expect(m2.usePromptStore.getState().currentPromptVersion).toBe('v2')
  })

  it('手工编辑后 customFields 写成空值（null）也能导入，并归一化为对象', () => {
    const edited = legacyYaml().replaceAll('customFields: {}', 'customFields:')
    expect(edited).not.toBe(legacyYaml())

    expect(m.useConfigStore.getState().importConfig(edited)).toEqual({ success: true })
    const providers = m.useAIConfigStore.getState().aiConfigManager.providers
    expect(providers.every((p) => p.customFields !== null && typeof p.customFields === 'object')).toBe(true)
  })

  it('不兼容的版本号被明确拒绝，且不改动现有配置', () => {
    const before = m.useAIConfigStore.getState().aiConfigManager.providers.length
    const res = m.useConfigStore.getState().importConfig(legacyYaml().replace('version: 1.0.0', 'version: 9.9.9'))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/9\.9\.9/)
    expect(m.useAIConfigStore.getState().aiConfigManager.providers).toHaveLength(before)
  })
})
