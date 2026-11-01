import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, flush } from '../uiTestUtils'
import { ReaderWorkspace } from '@/components/workspace/ReaderWorkspace'
import { BODY_MIN_WIDTH, COMPACT_BELOW, containerWidth, fitColumns, isCompactWidth, wideBonus } from '@/components/workspace/columns'
import { COMPANION_DEFAULT_WIDTH, COMPANION_MIN_WIDTH, NAV_DEFAULT_WIDTH, NAV_MIN_WIDTH, useReadingFocusStore } from '@/stores/readingFocus'
import type { BookSummary } from '@/types/book'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
  // jsdom 没有这些滚动 API（真实浏览器有）
  Element.prototype.scrollBy ??= function () {}
  Element.prototype.scrollTo ??= function () {}
  Element.prototype.scrollIntoView ??= function () {}
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

describe('fitColumns：正文列不被两侧挤没', () => {
  const base = { navWidth: NAV_DEFAULT_WIDTH, navCollapsed: false, companionWidth: COMPANION_DEFAULT_WIDTH, companionOpen: true }

  it('空间充足：原样返回', () => {
    expect(fitColumns({ ...base, container: 1700 })).toEqual({ nav: NAV_DEFAULT_WIDTH, companion: COMPANION_DEFAULT_WIDTH })
  })

  it('空间不够：先压对照栏，正文列恰好保住最小宽度', () => {
    const container = 1000
    const r = fitColumns({ ...base, container })
    expect(r.nav).toBe(NAV_DEFAULT_WIDTH) // 目录没动
    expect(r.companion).toBeLessThan(COMPANION_DEFAULT_WIDTH)
    expect(r.companion).toBeGreaterThanOrEqual(COMPANION_MIN_WIDTH)
    const used = r.nav + 8 + r.companion + 12 + 8
    expect(container - used).toBeGreaterThanOrEqual(BODY_MIN_WIDTH)
  })

  it('对照栏压到最小仍不够：再压目录，但不低于目录最小宽度', () => {
    const r = fitColumns({ ...base, navWidth: 360, companionWidth: 760, container: COMPACT_BELOW })
    expect(r.companion).toBe(COMPANION_MIN_WIDTH)
    expect(r.nav).toBeGreaterThanOrEqual(NAV_MIN_WIDTH)
    expect(r.nav).toBeLessThan(360)
  })

  it('任何 ≥ 紧凑阈值的容器：两栏取最小值时正文列也 ≥ 最小宽度（阈值选得自洽）', () => {
    const r = fitColumns({ ...base, navWidth: 360, companionWidth: 760, container: COMPACT_BELOW })
    expect(COMPACT_BELOW - (r.nav + 8 + r.companion + 12 + 8)).toBeGreaterThanOrEqual(BODY_MIN_WIDTH)
  })

  it('目录折叠 / 对照栏收起时按各自实际占用算，不多压', () => {
    const collapsed = fitColumns({ ...base, navCollapsed: true, container: 1000 })
    expect(collapsed.nav).toBe(NAV_DEFAULT_WIDTH) // 折叠时 nav 宽度值不被动
    expect(collapsed.companion).toBeGreaterThan(fitColumns({ ...base, container: 1000 }).companion)
    const closed = fitColumns({ ...base, companionOpen: false, container: 1000 })
    expect(closed.nav).toBe(NAV_DEFAULT_WIDTH)
  })

  it('偏好宽度不被改写：只是返回夹紧后的显示值', () => {
    const input = { ...base, container: 1000 }
    fitColumns(input)
    expect(input.companionWidth).toBe(COMPANION_DEFAULT_WIDTH)
  })
})

describe('isCompactWidth', () => {
  it('视口 → 容器宽度（扣页面边距，封顶 160rem）→ 与阈值比较', () => {
    expect(containerWidth(800)).toBe(752)
    expect(containerWidth(1808)).toBe(1760) // 与 CSS 在 1800px 以下封顶 110rem 一致
    expect(containerWidth(4000)).toBe(2560)
    expect(isCompactWidth(800)).toBe(true)
    expect(isCompactWidth(1024)).toBe(true) // 1024 - 48 = 976 < 1000
    expect(isCompactWidth(1100)).toBe(false)
  })
})

describe('wideBonus：超宽屏多出来的宽度', () => {
  it('1760 及以下没有加成（原布局不变）', () => {
    expect(wideBonus(1000)).toEqual({ nav: 0, companion: 0 })
    expect(wideBonus(1760)).toEqual({ nav: 0, companion: 0 })
  })

  it('超过部分：对照栏拿大头、目录小头，正文列至少留 1/3 以上', () => {
    const extra = 2560 - 1760
    const b = wideBonus(2560)
    expect(b.companion).toBeGreaterThan(b.nav)
    expect(b.nav + b.companion).toBeLessThan(extra * 0.7)
    expect(extra - b.nav - b.companion).toBeGreaterThan(extra * 0.3)
  })
})

const book = {
  title: '测试书',
  author: '作者',
  connections: '',
  overallSummary: '全书总结',
  chapters: [1, 2, 3].map((n) => ({ id: `c${n}`, title: `第${n}章`, content: `原文${n}`, processed: true, summary: `第${n}章总结` })),
} as unknown as BookSummary

const props = {
  bookSummary: book,
  file: null,
  processing: false,
  isMobile: false,
  totalChapters: 3,
  currentViewingChapter: 'c1',
  expandedChapters: new Set<string>(),
  chartsGenerating: false,
  source: null,
  onNavigateChapter: vi.fn(),
  onViewingChapterChange: vi.fn(),
  onClearChapterCache: vi.fn(),
  onClearSpecificCache: vi.fn(),
  onChapterExpandChange: vi.fn(),
  onReadChapter: vi.fn(),
  onDownloadAllMarkdown: vi.fn(),
}

let mounted: ReturnType<typeof mount> | null = null
const setViewport = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}
const realWidth = window.innerWidth
beforeEach(() => {
  useReadingFocusStore.setState({ companionOpen: true, companionWidth: COMPANION_DEFAULT_WIDTH, navWidth: NAV_DEFAULT_WIDTH, navCollapsed: false, focusMode: false })
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  setViewport(realWidth)
})

describe('ReaderWorkspace 布局', () => {
  it('宽屏（1440）：三栏——目录、正文、对照栏同时可见，对照栏宽度是偏好值', async () => {
    setViewport(1440)
    mounted = mount(<ReaderWorkspace {...props} />)
    await flush()
    const asides = mounted.container.querySelectorAll('aside')
    expect(asides.length).toBe(2)
    expect(Array.from(asides).some((a) => a.style.width === `${COMPANION_DEFAULT_WIDTH + 12}px`)).toBe(true)
    expect(mounted.container.textContent).not.toContain('对照面板') // 没有进入抽屉布局
  })

  it('窄窗口（800）：不硬挤三栏，改为「章节 / 对照面板」两个入口 + 单列正文', async () => {
    setViewport(800)
    mounted = mount(<ReaderWorkspace {...props} />)
    await flush()
    expect(mounted.container.querySelectorAll('aside').length).toBe(0)
    const labels = Array.from(mounted.container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels.some((l) => l?.includes('章节'))).toBe(true)
    expect(mounted.container.querySelector('main')).toBeTruthy()
  })

  it('中等宽度（1100）：仍是三栏，但对照栏被夹紧，不挤掉正文', async () => {
    setViewport(1100)
    mounted = mount(<ReaderWorkspace {...props} />)
    await flush()
    const dock = Array.from(mounted.container.querySelectorAll('aside')).find((a) => a.style.width !== '' && a.style.width !== `${NAV_DEFAULT_WIDTH}px`)!
    const w = parseInt(dock.style.width, 10)
    expect(w).toBeLessThan(COMPANION_DEFAULT_WIDTH + 12)
    expect(w).toBeGreaterThanOrEqual(COMPANION_MIN_WIDTH + 12)
    // 偏好值没被改写
    expect(useReadingFocusStore.getState().companionWidth).toBe(COMPANION_DEFAULT_WIDTH)
  })

  it('窗口缩放后自动切换布局（宽 → 窄）', async () => {
    setViewport(1440)
    mounted = mount(<ReaderWorkspace {...props} />)
    await flush()
    expect(mounted.container.querySelectorAll('aside').length).toBe(2)
    act(() => {
      setViewport(800)
      window.dispatchEvent(new Event('resize'))
    })
    await flush()
    expect(mounted.container.querySelectorAll('aside').length).toBe(0)
  })
})

describe('ReaderWorkspace 进入即有内容可读', () => {
  const withSummaries = (summaries: string[]) =>
    ({ ...book, chapters: summaries.map((summary, i) => ({ id: `c${i + 1}`, title: `第${i + 1}章`, content: '', processed: true, summary })) }) as unknown as BookSummary

  it('章节卡是外部受控的：没有已展开章节时，自动展开第一个有可用总结的章节（跳过失败/空的）', async () => {
    setViewport(1440)
    const onChapterExpandChange = vi.fn()
    mounted = mount(<ReaderWorkspace {...props} bookSummary={withSummaries(['【处理失败】超时', '', '第3章总结', '第4章总结'])} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).toHaveBeenCalledTimes(1)
    expect(onChapterExpandChange).toHaveBeenCalledWith('c3', true)
  })

  it('已经有展开的章节（用户操作过 / 从别处恢复）：不再干预', async () => {
    setViewport(1440)
    const onChapterExpandChange = vi.fn()
    mounted = mount(<ReaderWorkspace {...props} expandedChapters={new Set(['c2'])} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).not.toHaveBeenCalled()
  })

  it('每本书只自动展开一次：用户之后把它折叠起来，不会又被展开', async () => {
    setViewport(1440)
    const onChapterExpandChange = vi.fn()
    mounted = mount(<ReaderWorkspace {...props} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).toHaveBeenCalledTimes(1)
    mounted.rerender(<ReaderWorkspace {...props} expandedChapters={new Set()} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).toHaveBeenCalledTimes(1)
  })

  it('还没有任何可用总结（处理刚开始）：不动；总结出现后再展开', async () => {
    setViewport(1440)
    const onChapterExpandChange = vi.fn()
    mounted = mount(<ReaderWorkspace {...props} bookSummary={withSummaries(['', ''])} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).not.toHaveBeenCalled()
    mounted.rerender(<ReaderWorkspace {...props} bookSummary={withSummaries(['第1章总结', ''])} onChapterExpandChange={onChapterExpandChange} />)
    await flush()
    expect(onChapterExpandChange).toHaveBeenCalledWith('c1', true)
  })
})
