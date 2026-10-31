import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mount, click, flush } from '../uiTestUtils'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'
import { ChartsPanel } from '@/charts/ChartsPanel'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {}
  Element.prototype.scrollBy ??= function () {}
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

describe('10.2 目录条目：可读、不无提示截断', () => {
  const chapters = [{ id: 'c1', title: '01 镜像世界—— 下一代互联网的崛起', processed: true }, { id: 'c2', title: '序', processed: true }]
  const props = { chapters, totalChapters: 2, currentStepIndex: 2, processingMode: 'summary' as const, onChapterClick: vi.fn(), processing: false, currentViewingChapter: 'c2' }

  it('标题折行（line-clamp-2）、有 title 全称提示、点击区 ≥ 32px（min-h-8），而不是 truncate 单行', () => {
    m = mount(<ChapterSummaryNavigation {...props} />)
    const btn = Array.from(m.container.querySelectorAll<HTMLButtonElement>('button[title]')).find((b) => b.title.includes('镜像世界'))!
    expect(btn.title).toBe('01 镜像世界—— 下一代互联网的崛起')
    expect(btn.className).toContain('line-clamp-2')
    expect(btn.className).toContain('min-h-8')
    expect(btn.className).not.toContain('truncate')
  })

  it('副标题弱化但文字一个不丢', () => {
    m = mount(<ChapterSummaryNavigation {...props} />)
    const btn = Array.from(m.container.querySelectorAll<HTMLButtonElement>('button[title]')).find((b) => b.title.includes('镜像世界'))!
    expect(btn.textContent).toBe('01 镜像世界—— 下一代互联网的崛起')
    const weak = btn.querySelector('span')!
    expect(weak.className).toContain('opacity-60')
    expect(weak.textContent).toBe('—— 下一代互联网的崛起')
  })

  it('没有副标题的标题保持原样', () => {
    m = mount(<ChapterSummaryNavigation {...props} />)
    const btn = Array.from(m.container.querySelectorAll<HTMLButtonElement>('button[title]')).find((b) => b.title === '序')!
    expect(btn.querySelector('span')).toBeNull()
  })
})

describe('10.3 缺图表：按钮 + 费用提示，点击才生成', () => {
  it('没有图表且可生成：显示「生成关键图表」与费用提示，不自动调用', async () => {
    const onRegenerate = vi.fn()
    m = mount(<ChartsPanel charts={null} canRegenerate onRegenerate={onRegenerate} />)
    await flush()
    expect(onRegenerate).not.toHaveBeenCalled()
    expect(m.container.textContent).toContain('将调用一次 AI')
    const btn = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent?.includes('生成关键图表'))!
    click(btn)
    await flush()
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('没有总结可依据（不可生成）时不显示按钮', async () => {
    m = mount(<ChartsPanel charts={null} canRegenerate={false} onRegenerate={vi.fn()} />)
    await flush()
    expect(Array.from(m.container.querySelectorAll('button')).some((b) => b.textContent?.includes('生成关键图表'))).toBe(false)
  })

  it('生成中显示带动画的状态行（role=status）', async () => {
    m = mount(<ChartsPanel charts={null} generating canRegenerate onRegenerate={vi.fn()} />)
    await flush()
    const status = m.container.querySelector('[role="status"]')!
    expect(status.textContent).toContain('正在生成关键图表')
    expect(status.querySelector('svg.animate-spin')).toBeTruthy()
  })
})
