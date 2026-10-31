import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mount, click } from '../uiTestUtils'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'

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

const chapters = [1, 2, 3].map((n) => ({ id: `c${n}`, title: `第${n}章`, processed: true }))
const base = { chapters, totalChapters: 3, currentStepIndex: 2, processingMode: 'summary' as const, onChapterClick: vi.fn(), processing: false, currentViewingChapter: 'c1' }

describe('目录头：进度与操作同一行', () => {
  it('headerAction 和「阅读进度 1/3」在同一行（同一个 flex 行容器里），不另起一行', () => {
    const onCollapse = vi.fn()
    m = mount(
      <ChapterSummaryNavigation {...base} headerAction={<button type="button" aria-label="收起目录" onClick={onCollapse} />} />
    )
    const btn = m.container.querySelector<HTMLButtonElement>('button[aria-label="收起目录"]')!
    const row = btn.parentElement!
    expect(row.textContent).toContain('阅读进度')
    expect(row.textContent).toContain('1/3')
    click(btn)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('没有 headerAction 时与以前一致', () => {
    m = mount(<ChapterSummaryNavigation {...base} />)
    expect(m.container.textContent).toContain('阅读进度')
    expect(m.container.textContent).toContain('1/3')
  })

  it('抽屉（sheet）里头部右侧留出关闭按钮的位置，避免「×」压在 1/3 上；侧栏不留', () => {
    m = mount(<ChapterSummaryNavigation {...base} variant="sheet" />)
    const header = Array.from(m.container.querySelectorAll('div')).find((d) => d.className.includes('border-b') && d.textContent?.includes('阅读进度'))!
    expect(header.className).toContain('pr-12')
    m.rerender(<ChapterSummaryNavigation {...base} variant="sidebar" />)
    const side = Array.from(m.container.querySelectorAll('div')).find((d) => d.className.includes('border-b') && d.textContent?.includes('阅读进度'))!
    expect(side.className).not.toContain('pr-12')
  })
})
