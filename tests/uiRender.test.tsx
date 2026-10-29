import { act, Profiler, useCallback, useState, type ProfilerOnRenderCallback } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useShallow } from 'zustand/react/shallow'
import '../src/i18n'
import { useConfigStore, useTokenUsage } from '../src/stores/configStore'
import { ResultsSection } from '../src/components/sections/ResultsSection'
import { UnifiedStatusBar } from '../src/components/UnifiedStatusBar'
import type { BookSummary } from '../src/hooks/useBookProcessing'

// 渲染计数测试：不依赖 @testing-library，直接用 react-dom/client + act。
// Profiler 的 onRender 在父级更新时即使子树 bail out 也会触发，不能用来证明 memo 生效；
// 改为统计结果区内所有组件对 useTranslation 的调用次数（每次渲染都会调用一次）。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const i18nCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: ((...args: Parameters<typeof actual.useTranslation>) => {
      i18nCalls.n++
      return actual.useTranslation(...args)
    }) as typeof actual.useTranslation,
  }
})

const bookSummary: BookSummary = {
  title: '测试书',
  author: '作者',
  chapters: [
    { id: 'c1', title: '第一章', content: '原文一', summary: '## 摘要一' },
    { id: 'c2', title: '第二章', content: '原文二', summary: '## 摘要二' },
  ],
  connections: '关联',
  overallSummary: '全书',
} as BookSummary

const noop = () => {}
const EXPANDED = new Set<string>(['c1'])

let renders: Record<string, number> = {}
const onRender: ProfilerOnRenderCallback = (id) => {
  renders[id] = (renders[id] ?? 0) + 1
}

/** 模拟 App：父组件因 tokenUsage（如 useBookProcessing 内部订阅）而重渲染，向下传稳定 props */
function Harness() {
  const tokenUsage = useTokenUsage()
  const [expanded, setExpanded] = useState(EXPANDED)
  const handleExpand = useCallback((id: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  return (
    <div data-token={tokenUsage}>
      <ResultsSection
          processingMode="summary"
          bookSummary={bookSummary}
          bookMindMap={null}
          file={null}
          expandedChapters={expanded}
          onClearChapterCache={noop}
          onClearSpecificCache={noop}
          onChapterExpandChange={handleExpand}
          onReadChapter={noop}
          onDownloadAllMarkdown={noop}
        />
    </div>
  )
}

/** 与 App 相同的 selector 写法：只取 aiConfig / processingOptions / webdavConfig */
function AppLikeSelector() {
  useConfigStore(
    useShallow((s) => ({
      aiConfig: s.aiConfig,
      processingOptions: s.processingOptions,
      webdavConfig: s.webdavConfig,
    }))
  )
  return null
}

describe('渲染隔离：tokenUsage 变化不重渲染结果区', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    renders = {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      useConfigStore.getState().resetTokenUsage()
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('父组件随 tokenUsage 重渲染时，memo 的 ResultsSection 不重渲染', () => {
    act(() => root.render(<Harness />))
    expect(container.textContent).toContain('摘要一')
    const initial = i18nCalls.n
    expect(initial).toBeGreaterThan(0)

    act(() => useConfigStore.getState().addTokenUsage(100))
    act(() => useConfigStore.getState().addTokenUsage(250))

    // 父组件确实重渲染了，但结果区（ResultsSection 及其内部 MarkdownCard 等）一次也没有重新渲染
    expect(container.querySelector('[data-token]')?.getAttribute('data-token')).toBe('350')
    expect(i18nCalls.n).toBe(initial)
  })

  it('真实 props 变化（展开章节）时 ResultsSection 正常更新', () => {
    act(() => root.render(<Harness />))
    expect(container.textContent).not.toContain('摘要二')
    const before = i18nCalls.n

    const expandButtons = container.querySelectorAll<HTMLButtonElement>(
      '#chapter-summary-c2 button[aria-expanded="false"]'
    )
    expect(expandButtons.length).toBeGreaterThan(0)
    act(() => expandButtons[0].click())

    expect(i18nCalls.n).toBeGreaterThan(before)
    expect(container.textContent).toContain('摘要二')
  })

  it('App 同款 selector 订阅不因 tokenUsage 变化而重渲染', () => {
    act(() =>
      root.render(
        <Profiler id="app" onRender={onRender}>
          <AppLikeSelector />
        </Profiler>
      )
    )
    const initial = renders.app
    act(() => useConfigStore.getState().addTokenUsage(42))
    expect(renders.app).toBe(initial)
  })

  it('UnifiedStatusBar 自行订阅 tokenUsage 并显示', () => {
    const spy = vi.fn()
    act(() =>
      root.render(
        <Profiler id="bar" onRender={spy}>
          <UnifiedStatusBar currentView="processing" />
        </Profiler>
      )
    )
    act(() => useConfigStore.getState().addTokenUsage(1500))
    expect(container.textContent).toContain('1.5K')
  })
})
