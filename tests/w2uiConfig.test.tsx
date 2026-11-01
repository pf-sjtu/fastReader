/**
 * 配置相关 UI：纯函数、处理/章节/限流分区、章节预览、服务商面板、ConfigDialog 组合。
 *
 * 注意：AI 服务商配置已从「一模型一条目」改为「一服务商多模型」，服务商面板与新建向导
 * 分别见 AIProviderConfig / config/ProviderWizard。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, typeInto, waitFor, stubDomForRadix, selectOption, type Mounted } from './uiTestUtils'

// 边界 mock：AI 网络调用、章节解析
const { testConnection, previewChapters, toastFn } = vi.hoisted(() => ({
  testConnection: vi.fn(),
  previewChapters: vi.fn(),
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('../src/services/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/ai')>()
  return {
    ...real,
    AIService: class {
      testConnection = testConnection
    },
  }
})
vi.mock('../src/services/chapterPreviewService', () => ({ chapterPreviewService: { previewChapters } }))
vi.mock('sonner', () => ({ toast: toastFn }))

import { ConfigDialog } from '../src/components/project/ConfigDialog'
import { RateLimitSection } from '../src/components/project/config/RateLimitSection'
import { ProcessingSection } from '../src/components/project/config/ProcessingSection'
import { ChapterSection } from '../src/components/project/config/ChapterSection'
import { ChapterPreview } from '../src/components/project/config/ChapterPreview'
import { ActiveModelSelect } from '../src/components/project/config/ActiveModelSelect'
import { AIProviderConfig } from '../src/components/project/AIProviderConfig'
import { ProviderIcon } from '../src/components/project/config/ProviderIcon'
import { parseTemperature, parseNonNegativeInt } from '../src/components/project/config/numberInputs'
import {
  checkBaseUrl,
  formatContext,
  formatCost,
  mergeFetchedModels,
  modelLabelOf,
  nameFromBaseUrl,
  parseModelIds,
  parseTemperatureInput,
  priceOf,
} from '../src/components/project/config/provider-utils'
import { useConfigStore } from '../src/stores/configStore'
import { useAIConfigStore } from '../src/stores/ai-config'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)
const store = () => useConfigStore.getState()
const ai = () => useAIConfigStore.getState()
const byId = <T extends Element = HTMLInputElement>(id: string) => document.getElementById(id) as T | null

/** Textarea 的受控赋值（typeInto 只支持 input） */
function typeIntoTextarea(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

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

  it('服务商工具：名称/模型 id/上下文/价格', () => {
    expect(nameFromBaseUrl('https://api.x.com:8080/v1')).toBe('api.x.com:8080')
    expect(nameFromBaseUrl('not a url')).toBe('not a url')
    expect(modelLabelOf({ id: 'm1' })).toBe('m1')
    expect(modelLabelOf({ id: 'm1', label: '模型一' })).toBe('模型一')
    expect(formatContext(128000)).toBe('128K')
    expect(formatContext(1048576)).toBe('1M')
    expect(formatContext(undefined)).toBeNull()
    expect(formatCost(0.3)).toBe('0.3')
    expect(formatCost(0.001)).toBe('0.0010')
    expect(priceOf(undefined)).toBeNull()
    expect(priceOf({ inputCost: 1, outputCost: 2 })).toEqual(['1', '2'])
  })

  it('手填模型 id 去重保序；温度解析边界', () => {
    expect(parseModelIds('a, b\n c  ,a')).toEqual(['a', 'b', 'c'])
    expect(parseTemperatureInput('')).toBeUndefined()
    expect(parseTemperatureInput('abc')).toBeNull()
    expect(parseTemperatureInput('0')).toBe(0)
    expect(parseTemperatureInput('99')).toBe(2)
  })

  it('baseUrl 校验：非 Ollama 只接受 https', () => {
    expect(checkBaseUrl('openai', '')).toBe('required')
    expect(checkBaseUrl('openai', 'not-a-url')).toBe('invalid')
    expect(checkBaseUrl('openai', 'http://x.com/v1')).toBe('https')
    expect(checkBaseUrl('openai', 'https://x.com/v1')).toBeNull()
    expect(checkBaseUrl('ollama', 'http://localhost:11434')).toBeNull()
  })

  it('刷新模型：保留手动与已有设置，新模型在已有列表时默认停用', () => {
    const existing = [
      { id: 'a', enabled: true, source: 'manual' as const },
      { id: 'b', enabled: false, source: 'auto' as const },
    ]
    const merged = mergeFetchedModels(existing, ['b', 'c'])
    expect(merged.models.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(merged.models.find((x) => x.id === 'c')?.enabled).toBe(false)
    expect(merged.added).toBe(1)
    expect(merged.removed).toBe(0)

    // 首次获取（没有已有模型）时全部启用
    expect(mergeFetchedModels([], ['a', 'b']).models.every((x) => x.enabled)).toBe(true)
  })

  it('ProviderIcon 各协议都有图标', () => {
    for (const p of ['openai', 'gemini', 'ollama', undefined] as const) {
      m = mount(<ProviderIcon provider={p} />)
      expect(m.container.querySelector('svg')).toBeTruthy()
      m.unmount()
      m = null
    }
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
    expect(store().processingOptions.outputLanguage).toBe('auto')
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

describe('服务商面板（服务商维度 + 多模型）', () => {
  const seed = () => {
    const storeRef = ai()
    // 清空后建一个服务商，两个模型
    for (const provider of [...storeRef.ai.providers]) storeRef.deleteProvider(provider.id)
    const id = useAIConfigStore.getState().addProvider({
      name: 'demo-gateway',
      type: 'openai',
      baseUrl: 'https://api.demo.com/v1',
      models: [
        { id: 'm-a', enabled: true, source: 'manual' },
        { id: 'm-b', enabled: true, source: 'manual' },
      ],
    })
    useAIConfigStore.getState().setActiveModel(id, 'm-a')
    return id
  }

  it('列出服务商与模型数量，并标出当前模型', () => {
    seed()
    m = mount(<AIProviderConfig />)
    const text = m.container.textContent ?? ''
    expect(text).toContain('demo-gateway')
    expect(text).toContain(t('aiProvider.modelCount', { enabled: 2, total: 2 }))
    expect(text).toContain(t('aiProvider.currentModelBadge', { model: 'm-a' }))
  })

  it('切到另一个模型：当前模型随之变化', () => {
    const id = seed()
    ai().setActiveModel(id, 'm-b')
    m = mount(<AIProviderConfig />)
    expect(ai().ai.active.modelId).toBe('m-b')
    expect(m.container.textContent).toContain(t('aiProvider.currentModelBadge', { model: 'm-b' }))
  })

  it('删除服务商需确认，确认后从列表移除', async () => {
    seed()
    m = mount(<AIProviderConfig />)
    click(m.container.querySelector(`[aria-label="${t('common.delete')} demo-gateway"]`))
    await flush()
    expect(document.body.textContent).toContain(t('aiProvider.deleteTitle'))
    // 确认按钮在 AlertDialog 里，与卡片上的删除按钮同名，必须限定作用域
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')
    ).find((b) => b.textContent?.trim() === t('common.delete'))
    click(confirm)
    await flush()
    expect(ai().ai.providers).toHaveLength(0)
    expect(toastFn.success).toHaveBeenCalledWith(t('aiProvider.deleted', { name: 'demo-gateway' }))
  })

  it('新建向导：先选服务商，再填凭据与模型', async () => {
    m = mount(<AIProviderConfig />)
    click(findButton(t('aiProvider.add')))
    await flush()
    // 第一步：预设列表
    expect(document.body.textContent).toContain(t('aiProvider.wizard.step1'))
    click(findButton(new RegExp(t('aiProvider.wizard.fixed.openai'))))
    await flush()
    // 第二步：凭据
    expect(document.body.textContent).toContain(t('aiProvider.wizard.step2'))
    typeInto(byId('wizard-base-url')!, 'https://new.example/v1')
    typeInto(byId('wizard-name')!, 'new-gateway')
    typeInto(byId('wizard-api-key')!, 'sk-new')

    // 手填模型 id（多行 Textarea）
    click(findButton(new RegExp(t('aiProvider.wizard.manualToggle'))))
    typeIntoTextarea(byId<HTMLTextAreaElement>('wizard-manual-ids')!, 'x-1, x-2')
    await flush()

    click(findButton(t('aiProvider.create')))
    await flush()

    const provider = ai().ai.providers.find((p) => p.name === 'new-gateway')
    expect(provider).toBeTruthy()
    expect(provider!.baseUrl).toBe('https://new.example/v1')
    expect(provider!.models.map((x) => x.id).sort()).toEqual(['x-1', 'x-2'])
    expect(provider!.apiKey).toEqual({ hasSecret: true })
    expect(toastFn.success).toHaveBeenCalledWith(t('aiProvider.created'))
  })

  it('新建向导：非 https 地址被拦下，不发请求', async () => {
    m = mount(<AIProviderConfig />)
    click(findButton(t('aiProvider.add')))
    click(findButton(new RegExp(t('aiProvider.wizard.fixed.openai'))))
    typeInto(byId('wizard-base-url')!, 'http://insecure.example/v1')
    click(findButton(t('aiProvider.wizard.fetchModels')))
    await flush()
    expect(document.body.textContent).toContain(t('aiProvider.wizard.baseUrlIssue.https'))
    expect(ai().ai.providers).toHaveLength(0)
  })
})

describe('ActiveModelSelect', () => {
  it('按服务商分组列出已启用模型；无模型时给出提示', () => {
    m = mount(<ActiveModelSelect />)
    expect(m.container.textContent).toContain(t('aiProvider.noEnabledModels'))
    m.unmount()

    const id = ai().addProvider({
      name: 'demo',
      type: 'openai',
      baseUrl: 'https://api.demo.com/v1',
      models: [
        { id: 'm-a', enabled: true, source: 'manual' },
        { id: 'm-c', enabled: false, source: 'manual' },
      ],
    })
    ai().setActiveModel(id, 'm-a')
    m = mount(<ActiveModelSelect />)
    const trigger = m.container.querySelector('[role="combobox"]')
    expect(trigger?.textContent).toContain('m-a')
  })
})

describe('ConfigDialog 组合', () => {
  it('打开后各页签可见', async () => {
    previewChapters.mockResolvedValue([])
    m = mount(<ConfigDialog processing={false} file={null} />)
    click(findButton(t('config.title')))
    await flush()
    const text = document.body.textContent ?? ''
    expect(text).toContain(t('config.tabs.providers'))
    expect(text).toContain(t('config.tabs.processing'))
    expect(text).toContain(t('config.tabs.webdav'))
    expect(text).toContain(t('config.tabs.exportImport'))
  })
})
