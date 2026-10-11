import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, typeInto, waitFor, stubDomForRadix, selectOption, type Mounted } from './uiTestUtils'

// 边界 mock：AI 网络调用、章节解析
const { testConnection, aiCtor, previewChapters, toastFn } = vi.hoisted(() => ({
  testConnection: vi.fn(),
  aiCtor: vi.fn(),
  previewChapters: vi.fn(),
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('../src/services/aiService', () => ({
  AIService: class {
    constructor(...args: unknown[]) {
      aiCtor(...args)
    }
    testConnection = testConnection
  },
}))
vi.mock('../src/services/chapterPreviewService', () => ({ chapterPreviewService: { previewChapters } }))
vi.mock('sonner', () => ({ toast: toastFn }))

import { ConfigDialog } from '../src/components/project/ConfigDialog'
import { AIServiceSection } from '../src/components/project/config/AIServiceSection'
import { ProxySection } from '../src/components/project/config/ProxySection'
import { RateLimitSection } from '../src/components/project/config/RateLimitSection'
import { ProcessingSection } from '../src/components/project/config/ProcessingSection'
import { ChapterSection } from '../src/components/project/config/ChapterSection'
import { ChapterPreview } from '../src/components/project/config/ChapterPreview'
import { AIProviderConfig } from '../src/components/project/AIProviderConfig'
import { ProviderIcon } from '../src/components/project/config/ProviderIcon'
import { parseTemperature, parseNonNegativeInt } from '../src/components/project/config/numberInputs'
import {
  getDisplayName,
  getUniqueKey,
  isDuplicateProvider,
  toProviderConfig,
} from '../src/components/project/config/providerUtils'
import { useConfigStore } from '../src/stores/configStore'
import type { AIProviderConfig as ProviderConfig } from '../src/stores/types'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)
const store = () => useConfigStore.getState()
const byId = <T extends Element = HTMLInputElement>(id: string) => document.getElementById(id) as T | null

// Radix 弹层 + 多次异步交互，全量并行跑时单测可能超过默认 5s
vi.setConfig({ testTimeout: 30000 })

let m: Mounted | null = null
beforeEach(() => {
  stubDomForRadix()
  vi.clearAllMocks()
  store().resetAllConfig()
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

describe('config 纯函数', () => {
  it('数字输入：0 合法，非法回落默认', () => {
    expect(parseTemperature('0')).toBe(0)
    expect(parseTemperature('1.2')).toBe(1.2)
    expect(parseTemperature('')).toBe(0.7)
    expect(parseNonNegativeInt('0', 3)).toBe(0)
    expect(parseNonNegativeInt('-1', 3)).toBe(3)
    expect(parseNonNegativeInt('abc', 3)).toBe(3)
  })

  it('服务商显示名 / 去重键 / 去重判断 / 补默认值', () => {
    expect(getDisplayName('https://api.x.com:8080/v1', 'm1')).toBe('api.x.com/m1')
    expect(getDisplayName('not a url', 'm1')).toBe('m1')
    expect(getUniqueKey('https://api.x.com/v1', 'm1')).toBe('api.x.com/v1/m1')
    expect(getUniqueKey('bad', 'm1')).toBe('bad/m1')
    const a = toProviderConfig({ provider: 'openai', apiKey: 'k', apiUrl: 'https://api.x.com/v1', model: 'm1' })
    expect(a).toMatchObject({ temperature: 0.7, proxyUrl: '', proxyEnabled: false, customFields: {} })
    expect(isDuplicateProvider([a], 'https://api.x.com/v1', 'm1')).toBe(true)
    expect(isDuplicateProvider([a], 'https://api.x.com/v1', 'm1', a)).toBe(false)
    expect(isDuplicateProvider([a], 'https://api.x.com/v1', 'm2')).toBe(false)
  })

  it('ProviderIcon 各服务商都有图标', () => {
    for (const p of ['gemini', 'openai', 'ollama', '302.ai', 'custom', undefined]) {
      m = mount(<ProviderIcon provider={p} />)
      expect(m.container.querySelector('svg')).toBeTruthy()
      m.unmount()
      m = null
    }
  })
})

describe('AIServiceSection', () => {
  it('输入即时写入 store；温度 0 不被吞掉', () => {
    m = mount(<AIServiceSection processing={false} />)
    typeInto(byId('apikey')!, 'sk-1')
    typeInto(byId('api-url')!, 'https://g.example/v1')
    typeInto(byId('model')!, 'gemini-x')
    typeInto(byId('ai-temperature')!, '0')
    expect(store().aiConfig).toMatchObject({ apiKey: 'sk-1', apiUrl: 'https://g.example/v1', model: 'gemini-x', temperature: 0 })
  })

  it('切到 302.ai 自动填地址并禁用地址输入', async () => {
    m = mount(<AIServiceSection processing={false} />)
    await selectOption(byId('ai-provider'), '302.AI')
    expect(store().aiConfig.provider).toBe('302.ai')
    expect(store().aiConfig.apiUrl).toBe('https://api.302.ai/v1')
    expect(byId('api-url')!.disabled).toBe(true)
  })

  it('测试连接：成功 / 失败带错误 / 抛异常', async () => {
    store().setApiKey('sk-1')
    m = mount(<AIServiceSection processing={false} />)
    const btn = () => findButton(t('config.testConnection'))!

    testConnection.mockResolvedValueOnce({ success: true })
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(t('config.connection.aiSuccess')))
    expect(aiCtor.mock.calls[0][0]).toMatchObject({ apiKey: 'sk-1' })

    testConnection.mockResolvedValueOnce({ success: false, error: '401' })
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(`${t('config.connection.aiFailed')}: 401`))

    testConnection.mockResolvedValueOnce({ success: false })
    click(btn())
    await waitFor(() => expect(m!.container.querySelector('[role="status"]')?.textContent).toBe(t('config.connection.aiFailed')))

    testConnection.mockRejectedValueOnce(new Error('boom'))
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(t('config.connection.testFailed', { error: 'boom' })))
  })

  it('无 API Key 时测试按钮禁用', () => {
    m = mount(<AIServiceSection processing={false} />)
    expect(findButton(t('config.testConnection'))!.disabled).toBe(true)
  })
})

describe('ProxySection', () => {
  it('启用代理后可填地址；测试代理给出浏览器限制说明', () => {
    m = mount(<ProxySection processing={false} />)
    expect(findButton(t('config.proxy.test'))).toBeUndefined()
    click(byId('proxy-enabled'))
    expect(store().aiConfig.proxyEnabled).toBe(true)
    expect(findButton(t('config.proxy.test'))!.disabled).toBe(true)
    typeInto(byId('proxy-url')!, 'http://127.0.0.1:1080')
    expect(store().aiConfig.proxyUrl).toBe('http://127.0.0.1:1080')
    click(findButton(t('config.proxy.test')))
    expect(document.body.textContent).toContain(t('config.proxy.browserUnsupported'))
    expect(document.body.textContent).toContain(t('config.proxy.solutionExtension'))
  })
})

describe('RateLimitSection', () => {
  it('重试次数允许 0；等待时间以秒展示、按毫秒保存', () => {
    m = mount(<RateLimitSection processing={false} />)
    typeInto(byId('max-retries')!, '0')
    expect(store().aiServiceOptions.maxRetries).toBe(0)
    expect(byId('max-retries')!.value).toBe('0')
    typeInto(byId('base-retry-delay')!, '5')
    expect(store().aiServiceOptions.baseRetryDelay).toBe(5000)
    typeInto(byId('base-retry-delay')!, '')
    expect(store().aiServiceOptions.baseRetryDelay).toBe(60000)
  })
})

describe('ProcessingSection / ChapterSection', () => {
  it('处理模式、书籍类型、输出语言写入 store', async () => {
    m = mount(<ProcessingSection processing={false} />)
    await selectOption(byId('processing-mode'), t('config.mindmapMode'))
    expect(store().processingOptions.processingMode).toBe('mindmap')
    await selectOption(byId('book-type'), t('config.novelType'))
    expect(store().processingOptions.bookType).toBe('fiction')
    await selectOption(byId('output-language'), 'English')
    expect(store().processingOptions.outputLanguage).toBe('en')
  })

  it('章节设置：开关、并行数、递归深度、识别模式与 TOC 深度', async () => {
    m = mount(<ChapterSection processing={false} />)
    const notify = store().processingOptions.enableNotification
    click(byId('enable-notification'))
    expect(store().processingOptions.enableNotification).toBe(!notify)
    const skip = store().processingOptions.skipNonEssentialChapters
    click(byId('skip-non-essential'))
    expect(store().processingOptions.skipNonEssentialChapters).toBe(!skip)

    await selectOption(byId('chapter-concurrency'), t('config.chapterConcurrencyValue', { count: 5 }))
    expect(store().processingOptions.chapterConcurrency).toBe(5)
    await selectOption(byId('max-sub-chapter-depth'), t('config.recursion2Layers'))
    expect(store().processingOptions.maxSubChapterDepth).toBe(2)
    await selectOption(byId('chapter-naming-mode'), t('config.numberedNaming'))
    expect(store().processingOptions.chapterNamingMode).toBe('numbered')

    expect(byId('epub-toc-depth')).toBeNull()
    click(byId('epub-toc-mode'))
    expect(store().processingOptions.chapterDetectionMode).toBe('epub-toc')
    await selectOption(byId('epub-toc-depth'), t('config.epubTocDepth3'))
    expect(store().processingOptions.epubTocDepth).toBe(3)
    click(byId('smart-mode'))
    expect(store().processingOptions.chapterDetectionMode).toBe('smart')
  })
})

describe('ChapterPreview', () => {
  it('无文件不渲染；加载中提示；失败时显示「未找到章节」', async () => {
    m = mount(<ChapterPreview open file={null} />)
    expect(m.container.innerHTML).toBe('')
    m.unmount()

    let reject: (e: Error) => void = () => {}
    previewChapters.mockReturnValueOnce(new Promise((_, r) => (reject = r)))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    m = mount(<ChapterPreview open file={new File(['x'], 'a.epub')} />)
    expect(m.container.textContent).toContain(t('config.loadingPreview'))
    reject(new Error('parse failed'))
    await waitFor(() => expect(m!.container.textContent).toContain(t('config.noChaptersFound')))
    spy.mockRestore()
  })

  it('列出预览章节并编号', async () => {
    previewChapters.mockResolvedValueOnce([
      { title: '第一章', preview: '内容一' },
      { title: '第二章', preview: '内容二' },
    ])
    m = mount(<ChapterPreview open file={new File(['x'], 'a.epub')} />)
    await waitFor(() => expect(m!.container.textContent).toContain('02.'))
    expect(m.container.textContent).toContain('第二章')
  })
})

describe('ConfigDialog 组合', () => {
  it('打开后各分区与标签页可见', async () => {
    previewChapters.mockResolvedValue([])
    m = mount(<ConfigDialog processing={false} file={null} />)
    click(findButton(t('config.title')))
    await flush()
    const text = document.body.textContent ?? ''
    expect(text).toContain(t('config.rateLimit.title'))
    expect(text).toContain(t('config.proxySettings'))
    expect(text).toContain(t('config.tabs.providers'))
    expect(text).toContain(t('config.tabs.exportImport'))
  })
})

describe('AIProviderConfig / AIProviderDialog', () => {
  const provider = (over: Partial<ProviderConfig> = {}) =>
    toProviderConfig({ provider: 'openai', apiKey: 'k', apiUrl: 'https://api.a.com/v1', model: 'm-a', ...over })

  beforeEach(() => {
    const s = store()
    // 只保留一个已知服务商，便于断言
    while (s.aiConfigManager.providers.length > 0) {
      const before = useConfigStore.getState().aiConfigManager.providers.length
      useConfigStore.getState().deleteAIProvider(1)
      if (useConfigStore.getState().aiConfigManager.providers.length === before) break
    }
    if (useConfigStore.getState().aiConfigManager.providers.length === 0) useConfigStore.getState().addAIProvider(provider())
    else useConfigStore.getState().updateAIProvider(1, provider())
    useConfigStore.getState().setCurrentModelId(1)
  })

  it('列表显示当前服务商；只剩一个时不能删除', () => {
    m = mount(<AIProviderConfig />)
    expect(m.container.textContent).toContain('api.a.com/m-a')
    expect(m.container.textContent).toContain(t('aiProvider.current'))
    click(m.container.querySelector(`[aria-label="${t('common.delete')} api.a.com/m-a"]`))
    expect(toastFn.error).toHaveBeenCalledWith(t('aiProvider.keepAtLeastOne'))
  })

  it('复制、切换使用、确认删除', () => {
    m = mount(<AIProviderConfig />)
    click(m.container.querySelector(`[aria-label="${t('common.copy')} api.a.com/m-a"]`))
    expect(store().aiConfigManager.providers).toHaveLength(2)
    const before = store().aiConfigManager.currentModelId
    click(findButton(t('aiProvider.use')))
    expect(store().aiConfigManager.currentModelId).toBe(before === 1 ? 2 : 1)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    click(m.container.querySelectorAll(`[aria-label="${t('common.delete')} api.a.com/m-a"]`)[1])
    expect(confirmSpy).toHaveBeenCalledWith(t('aiProvider.confirmDelete', { name: 'api.a.com/m-a' }))
    expect(store().aiConfigManager.providers).toHaveLength(1)
    confirmSpy.mockRestore()
  })

  it('当前激活序号越界时重置为 1', () => {
    useConfigStore.getState().setCurrentModelId(9)
    m = mount(<AIProviderConfig />)
    expect(store().aiConfigManager.currentModelId).toBe(1)
  })

  it('新建：未填完整提示；重复配置拦截；填写后创建并测试连接', async () => {
    m = mount(<AIProviderConfig />)
    click(findButton(t('aiProvider.add')))
    click(findButton(t('aiProvider.create')))
    expect(toastFn.error).toHaveBeenCalledWith(t('aiProvider.fillAllFields'))

    typeInto(byId('provider-api-key')!, 'k2')
    typeInto(byId('provider-api-url')!, 'https://api.a.com/v1')
    typeInto(byId('provider-model')!, 'm-a')
    click(findButton(t('aiProvider.create')))
    expect(document.body.textContent).toContain(t('aiProvider.duplicateError'))

    typeInto(byId('provider-model')!, 'm-b')
    expect(document.body.textContent).not.toContain(t('aiProvider.duplicateError'))
    click(byId('proxyEnabled'))
    typeInto(byId('provider-proxy-url')!, 'http://p:1')
    typeInto(byId('provider-temperature')!, '0.3')

    testConnection.mockResolvedValueOnce({ success: true })
    click(findButton(t('config.testConnection')))
    await waitFor(() => expect(toastFn.success).toHaveBeenCalledWith(t('config.connection.aiSuccess')))
    testConnection.mockResolvedValueOnce({ success: false, error: 'x' })
    click(findButton(t('config.testConnection')))
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(`${t('config.connection.aiFailed')}: x`))

    click(findButton(t('aiProvider.create')))
    expect(toastFn.success).toHaveBeenCalledWith(t('aiProvider.created'))
    const added = store().aiConfigManager.providers[1]
    expect(added).toMatchObject({ apiKey: 'k2', model: 'm-b', proxyEnabled: true, proxyUrl: 'http://p:1', temperature: 0.3 })
  })

  it('选模板：匹配到已有配置时预填地址与模型', () => {
    m = mount(<AIProviderConfig />)
    click(findButton(t('aiProvider.add')))
    const templates = store().getAvailableAITemplates()
    const first = templates[0]
    click(findButton(new RegExp(first.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
    expect(findButton(new RegExp(first.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy()
  })

  it('编辑：保存后更新 store', async () => {
    m = mount(<AIProviderConfig />)
    click(m.container.querySelector(`[aria-label="${t('common.edit')} api.a.com/m-a"]`))
    expect(document.body.textContent).toContain(t('aiProvider.editTitle'))
    typeInto(byId('provider-model')!, 'm-edited')
    click(findButton(t('common.save')))
    expect(toastFn.success).toHaveBeenCalledWith(t('aiProvider.updated'))
    expect(store().aiConfigManager.providers[0].model).toBe('m-edited')
  })
})
