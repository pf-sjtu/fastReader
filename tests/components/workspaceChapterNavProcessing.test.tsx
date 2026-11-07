/**
 * 处理中目录守卫：目录始终是「整本书的目录」，正在处理的章有淡色 + 动效，
 * 目录收起后的竖向进度条要画出处理进度（已完成段主色 + 处理段 info 色）。
 */
import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { mount, type Mounted } from '../uiTestUtils'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'
import { NavRail } from '@/components/workspace/NavRail'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
  // jsdom 没有 Element.scrollBy：目录自动滚到当前章会调用它
  if (!Element.prototype.scrollBy) {
    Element.prototype.scrollBy = () => {}
  }
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const chapters = [
  { id: 'c1', title: '第1章 已完成', processed: true },
  { id: 'c2', title: '第2章 正在处理', processed: false },
  { id: 'c3', title: '第3章 未开始', processed: false },
]

describe('处理中的章节目录', () => {
  it('显示完整章节清单，未开始章节不渲染为可点', () => {
    m = mount(
      <ChapterSummaryNavigation
        chapters={chapters}
        totalChapters={3}
        currentStepIndex={2}
        processingMode="summary"
        processing
        currentProcessingChapter="c2"
        currentViewingChapter="c1"
        onChapterClick={vi.fn()}
      />
    )
    const text = m.container.textContent ?? ''
    expect(text).toContain('第1章 已完成')
    expect(text).toContain('第2章 正在处理')
    expect(text).toContain('第3章 未开始')

    const buttons = m.container.querySelectorAll<HTMLButtonElement>('[data-chapter-id] button[title]')
    const c1 = m.container.querySelector<HTMLButtonElement>('[data-chapter-id="c1"] button[title]')
    const c3 = m.container.querySelector<HTMLButtonElement>('[data-chapter-id="c3"] button')
    expect(buttons.length).toBe(3)
    expect(c1?.disabled).toBe(false)
    expect(c3?.disabled).toBe(true)
  })

  it('正在处理的章节：标题比未处理更淡，并有旋转节点与扫动条', () => {
    m = mount(
      <ChapterSummaryNavigation
        chapters={chapters}
        totalChapters={3}
        currentStepIndex={2}
        processingMode="summary"
        processing
        currentProcessingChapter="c2"
        currentViewingChapter="c1"
        onChapterClick={vi.fn()}
      />
    )
    const row = m.container.querySelector('[data-chapter-id="c2"]')
    expect(row?.getAttribute('data-processing')).toBe('true')
    expect(row?.getAttribute('aria-busy')).toBe('true')

    const title = row?.querySelector('button')
    expect(title?.className).toContain('text-muted-foreground/25')
    // 未处理章节是 /35：处理中必须更淡
    const todo = m.container.querySelector('[data-chapter-id="c3"] button')
    expect(todo?.className).toContain('text-muted-foreground/35')

    expect(m.container.querySelectorAll('.animate-spin').length).toBe(1)
    expect(m.container.querySelectorAll('.chapter-processing-sweep').length).toBe(1)
    // 只有处理中的那一行有扫动条
    expect(m.container.querySelectorAll('.chapter-processing-track').length).toBe(1)
  })
})

describe('收起后的竖向进度条', () => {
  const railChapters = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, title: `第${i + 1}章` }))

  it('处理中：已完成段按比例填充，正在处理的那一章用 info 色脉冲', () => {
    m = mount(
      <NavRail chapters={railChapters} current={0} processing processedCount={2} processingChapterId="c3" onExpand={vi.fn()} />
    )
    const bar = m.container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-label')).toBe('处理进度')
    expect(bar?.getAttribute('aria-valuenow')).toBe('2')
    expect(bar?.getAttribute('aria-valuetext')).toBe('2/5')

    const fill = m.container.querySelector('[data-testid="rail-fill"]')
    expect((fill as HTMLElement).style.height).toBe('40%')
    expect(fill?.className).toContain('bg-primary')

    const segment = m.container.querySelector('[data-testid="rail-processing-segment"]') as HTMLElement | null
    expect(segment).toBeTruthy()
    expect(segment?.className).toContain('bg-info')
    expect(segment?.style.top).toBe('40%')
    expect(segment?.style.height).toBe('20%')

    const processingDot = m.container.querySelector('li[data-state="processing"] span')
    expect(processingDot?.className).toContain('bg-info')
  })

  it('处理结束后：恢复阅读进度与主色，不再画处理段', () => {
    m = mount(<NavRail chapters={railChapters} current={3} onExpand={vi.fn()} />)
    const bar = m.container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-label')).toBe('阅读进度')
    expect(bar?.getAttribute('aria-valuenow')).toBe('3')
    expect(m.container.querySelector('[data-testid="rail-processing-segment"]')).toBeNull()
    expect(m.container.querySelector('li[data-state="current"]')).toBeTruthy()
    const fill = m.container.querySelector('[data-testid="rail-fill"]')
    expect(fill?.className).toContain('bg-primary')
  })
})
