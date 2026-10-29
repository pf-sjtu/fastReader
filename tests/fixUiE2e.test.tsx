/**
 * 浏览器端到端测试暴露的 UI 问题回归（fixUiE2e）：
 * 整书导图页签、全章节失败提示、进度序号、输出语言默认值、主题切换、设置标题、toast 去重、移动端布局类
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, stubDomForRadix, type Mounted } from './uiTestUtils'

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  pipeline: vi.fn(),
  recordHistory: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../src/services/pipeline/bookPipeline', () => ({ runBookPipeline: h.pipeline }))
vi.mock('../src/services/pipeline/persistence', () => ({
  createLocalPipelineCache: vi.fn(async () => null),
  recordHistory: h.recordHistory,
  syncMindMapResult: vi.fn(async () => false),
  syncSummaryResult: vi.fn(async () => ({ mdFailed: false, chartsError: null })),
}))
vi.mock('../src/services/ai', () => ({ AIService: class {} }))
vi.mock('../src/services/notificationService', () => ({
  notificationService: { sendTaskCompleteNotification: vi.fn(), sendErrorNotification: vi.fn() },
}))
vi.mock('../src/components/MindMapCard', () => ({
  MindMapCard: ({ id }: { id: string }) => <div data-testid={`mm-${id}`} />,
}))
vi.mock('../src/charts', () => ({ ChartsPanel: () => null }))

import { ResultsSection } from '../src/components/sections/ResultsSection'
import { useProcessingRun, type ProcessingRunDeps } from '../src/hooks/useProcessingRun'
import { useProcessingStore } from '../src/stores/processing'
import { createGenerationCounter } from '../src/utils/runGuard'
import { DarkModeToggle } from '../src/components/DarkModeToggle'
import { ThemeProvider } from '../src/components/ThemeProvider'
import { ConfigDialog } from '../src/components/project/ConfigDialog'
import { PromptEditor } from '../src/components/project/PromptEditor'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)
let m: Mounted | null = null

beforeEach(() => {
  stubDomForRadix()
  vi.clearAllMocks()
  localStorage.clear()
  document.documentElement.className = ''
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const noop = () => {}
const baseProps = {
  bookSummary: null,
  file: null,
  expandedChapters: new Set<string>(),
  onClearChapterCache: noop,
  onClearSpecificCache: noop,
  onChapterExpandChange: noop,
  onReadChapter: noop,
  onDownloadAllMarkdown: noop,
}
const mindMap = (combined: unknown) => ({
  title: 'B',
  author: 'A',
  chapters: [{ id: 'c1', title: '一', content: 'x', mindMap: { nodeData: { id: 'r', topic: 'r' } } }],
  combinedMindMap: combined,
})

describe('1. mindmap 模式不产出整书导图', () => {
  it('combinedMindMap 为 null：不显示「整合」页签，也没有永久加载态', () => {
    m = mount(<ResultsSection {...baseProps} processingMode="mindmap" bookMindMap={mindMap(null) as never} />)
    const text = m.container.textContent ?? ''
    expect(text).not.toContain(t('results.generatingMindMap'))
    expect(text).not.toContain(t('results.tabs.combinedMindMap'))
    expect(text).toContain(t('results.tabs.chapterMindMaps'))
  })

  it('已有整书导图数据（如历史加载）：显示该页签', () => {
    m = mount(
      <ResultsSection
        {...baseProps}
        processingMode="mindmap"
        bookMindMap={mindMap({ nodeData: { id: 'r', topic: 'r' } }) as never}
      />
    )
    expect(m.container.textContent).toContain(t('results.tabs.combinedMindMap'))
  })

  it('combined-mindmap 模式处理中仍显示加载态', () => {
    m = mount(
      <ResultsSection {...baseProps} processingMode="combined-mindmap" bookMindMap={mindMap(null) as never} />
    )
    expect(m.container.textContent).toContain(t('results.generatingMindMap'))
  })
})

describe('4. 结果区头部章数', () => {
  it('处理中尚无章节结果时显示预期总章数而非空插值', () => {
    const empty = { title: 'B', author: 'A', chapters: [], combinedMindMap: null }
    m = mount(<ResultsSection {...baseProps} processingMode="mindmap" bookMindMap={empty as never} totalChapters={7} />)
    expect(m.container.textContent).toContain(t('results.chapterCount', { count: 7 }))
  })
})

describe('2/4/9. useProcessingRun', () => {
  const box: { api: ReturnType<typeof useProcessingRun> | null } = { api: null }
  const chapters = [
    { id: 'a', title: 'Ch A', content: 'x' },
    { id: 'b', title: 'Ch B', content: 'y' },
    { id: 'c', title: 'Ch C', content: 'z' },
  ]
  function Harness() {
    const deps: ProcessingRunDeps = {
      generationRef: { current: gen },
      file: new File(['x'], 'b.epub'),
      extractedChapters: chapters as never,
      selectedChapters: new Set(['a', 'b', 'c']),
      bookData: { title: 'T', author: 'A' },
      customPrompt: '',
      getBookId: async () => 'id',
      cloudCacheKeyRef: { current: null },
      setBookSummary: noop,
      setBookMindMap: noop,
      clearResults: noop,
    }
    box.api = useProcessingRun(deps)
    return null
  }
  let gen = createGenerationCounter()
  beforeEach(() => {
    gen = createGenerationCounter()
    useProcessingStore.getState().updateProcessingOptions({ enableNotification: false, processingMode: 'summary' })
  })

  const result = (usable: number, warnings: string[] = []) => ({
    chapters: [],
    connections: '',
    overall: '',
    warnings,
    isPartial: usable < 3,
    stats: { total: 3, usable, failed: 3 - usable, skipped: 0, cached: 0 },
  })

  it('全部章节失败：error toast + 失败步骤文案 + 不记历史，不出现成功文案', async () => {
    h.pipeline.mockResolvedValue(result(0, ['connections']))
    m = mount(<Harness />)
    await act(async () => {
      await box.api!.processBook()
    })
    expect(h.toast.error).toHaveBeenCalledWith(t('progress.allChaptersFailed'), expect.anything())
    expect(h.toast.success).not.toHaveBeenCalled()
    expect(h.recordHistory).not.toHaveBeenCalled()
    expect(box.api!.currentStep).toBe(t('progress.allChaptersFailed'))
  })

  it('部分失败（usable>0）：保持原有警告成功提示并记历史', async () => {
    h.pipeline.mockResolvedValue(result(1, ['connections']))
    m = mount(<Harness />)
    await act(async () => {
      await box.api!.processBook()
    })
    expect(h.toast.error).not.toHaveBeenCalled()
    expect(h.toast.success).toHaveBeenCalledWith(t('progress.completedWithWarnings'))
    expect(h.recordHistory).toHaveBeenCalledTimes(1)
    expect(box.api!.currentStep).toBe(t('progress.completed'))
  })

  it('并发时进度文案的序号与标题属于同一章（用章节自身位置，而非已完成数）', async () => {
    let release: () => void = () => {}
    h.pipeline.mockImplementation(async (input: { onChapterStart: (c: unknown, d: number, n: number) => void }) => {
      // 第 3 章先开始、此时按序已完成 0 章
      input.onChapterStart(chapters[2], 0, 3)
      await new Promise<void>((r) => (release = r))
      return result(3)
    })
    m = mount(<Harness />)
    const steps: string[] = []
    let p: Promise<void> | undefined
    await act(async () => {
      p = box.api!.processBook()
      await new Promise((r) => setTimeout(r, 0))
    })
    steps.push(box.api!.currentStep)
    await act(async () => {
      release()
      await p
    })
    expect(steps[0]).toBe(t('progress.processingChapter', { current: 3, total: 3, title: 'Ch C' }))
  })

  it('主动中止：两处 toast 使用同一固定 id，sonner 会去重', async () => {
    h.pipeline.mockImplementation(async () => {
      const e = new DOMException('aborted', 'AbortError')
      throw e
    })
    m = mount(<Harness />)
    await act(async () => {
      await box.api!.processBook()
    })
    act(() => box.api!.cancelProcessing())
    const ids = h.toast.info.mock.calls.map((c) => (c[1] as { id?: string } | undefined)?.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBeTruthy()
  })
})

describe('5. 输出语言默认值', () => {
  it('新用户默认 auto（跟随界面语言），重置同样回到 auto；已有持久化值不受影响', () => {
    const fresh = useProcessingStore.getState()
    fresh.resetProcessingOptions()
    expect(useProcessingStore.getState().processingOptions.outputLanguage).toBe('auto')
    fresh.setOutputLanguage('zh')
    fresh.resetProcessingOptions()
    expect(useProcessingStore.getState().processingOptions.outputLanguage).toBe('auto')
  })
})

describe('7. 深色模式切换基于实际生效主题', () => {
  const stubSystemDark = (dark: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: dark && q.includes('dark'),
      media: q,
      addEventListener: noop,
      removeEventListener: noop,
    }))
  afterEach(() => vi.unstubAllGlobals())

  it('系统为深色、主题为 system：首次点击就切到浅色（有可见变化）', () => {
    stubSystemDark(true)
    m = mount(
      <ThemeProvider>
        <DarkModeToggle />
      </ThemeProvider>
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    click(m.container.querySelector('button'))
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('系统为浅色、主题为 system：首次点击切到深色', () => {
    stubSystemDark(false)
    m = mount(
      <ThemeProvider>
        <DarkModeToggle />
      </ThemeProvider>
    )
    click(m.container.querySelector('button'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('8. 设置对话框标题跟随页签', () => {
  it('切换页签后标题随之变化', async () => {
    m = mount(<ConfigDialog processing={false} file={null} />)
    click(findButton(t('config.title')))
    await flush()
    const title = () => document.querySelector('[role="dialog"] h2')?.textContent?.trim()
    expect(title()).toBe(t('config.tabs.providers'))
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (e) => e.textContent?.trim() === t('config.tabs.webdav')
    )!
    // Radix Tabs 在 mousedown 时激活
    act(() => {
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }))
    })
    await flush()
    expect(title()).toBe(t('config.tabs.webdav'))
  })
})

describe('3. 移动端布局（jsdom 无布局引擎，断言防溢出的结构性类；实际宽度已用 375px 浏览器核对）', () => {
  it('PromptEditor 的工具栏允许换行，页签网格在窄屏为 2 列', () => {
    m = mount(<PromptEditor />)
    const html = m.container.innerHTML
    expect(html).toContain('flex-wrap')
    expect(m.container.querySelector('[role="tablist"]')?.className).toContain('grid-cols-2')
    expect(m.container.querySelector('[role="tablist"]')?.className).toContain('sm:grid-cols-4')
  })
})
