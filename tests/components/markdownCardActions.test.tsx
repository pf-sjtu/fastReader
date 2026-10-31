import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, flush, click } from '../uiTestUtils'
import { MarkdownCard } from '@/components/MarkdownCard'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const onExpandChange = vi.fn()
const card = (extra: Partial<React.ComponentProps<typeof MarkdownCard>> = {}) => (
  <MarkdownCard id="c1" title="第一章 从标牌到纳贝斯克" content="这是第一章的完整原文" markdownContent="## 摘要" index={0} isExpanded={false} onExpandChange={onExpandChange} onClearCache={vi.fn()} onReadChapter={vi.fn()} {...extra} />
)
const root = () => m!.container.querySelector('[data-slot="card"]') as HTMLElement
const toggle = () => root().querySelector<HTMLButtonElement>('button[aria-expanded]')!
const toolbar = () => root().querySelector('[role="toolbar"]')
const openMenu = async () => {
  const trigger = root().querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!
  act(() => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await flush()
}
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))

describe('MarkdownCard：折叠态只留「序号 + 标题 + 箭头」', () => {
  it('折叠时整张卡只有一个按钮（整行可点），没有任何操作图标；标题完整、带序号', () => {
    m = mount(card())
    expect(root().querySelectorAll('button')).toHaveLength(1)
    expect(toolbar()).toBeNull()
    expect(toggle().textContent).toContain('第一章 从标牌到纳贝斯克')
    expect(toggle().textContent).toContain('01')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    // 标题不再被截断（旧版 truncate 会被按钮挤成「推荐序一 …」）
    expect(toggle().querySelector('.truncate')).toBeNull()
  })

  it('点整行切换展开（受控模式回调带章节 id）；读屏名称含标题', () => {
    m = mount(card())
    click(toggle())
    expect(onExpandChange).toHaveBeenCalledWith(true, 'c1')
    expect(toggle().getAttribute('aria-label')).toContain('第一章 从标牌到纳贝斯克')
  })

  it('showIndex=false（全书关联/总结这类单张卡）不显示序号', () => {
    m = mount(card({ showIndex: false }))
    expect(toggle().textContent).not.toContain('01')
  })
})

describe('MarkdownCard：展开后才出现工具栏（复制 / 阅读原文 / 更多）', () => {
  it('工具栏三项都在，带文字标签而不是纯图标', () => {
    m = mount(card({ isExpanded: true }))
    const labels = Array.from(toolbar()!.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.textContent?.trim())
    expect(labels).toEqual(['复制', '阅读原文', '更多操作'])
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
  })

  it('「查看内容」在更多菜单里，点开显示该章完整原文弹窗；「清除缓存」仍在菜单里', async () => {
    m = mount(card({ isExpanded: true }))
    await openMenu()
    const items = menuItems().map((i) => i.textContent?.trim())
    expect(items).toContain('原文内容')
    expect(items.some((t) => t?.includes('清除'))).toBe(true)
    act(() => menuItems().find((i) => i.textContent?.includes('原文内容'))!.click())
    await flush()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('这是第一章的完整原文')
  })

  it('点「阅读原文」回调带章节 id；没有回调时不渲染该按钮', () => {
    const onReadChapter = vi.fn()
    m = mount(card({ isExpanded: true, onReadChapter }))
    click(Array.from(toolbar()!.querySelectorAll('button')).find((b) => b.textContent?.includes('阅读原文')))
    expect(onReadChapter).toHaveBeenCalledWith('c1')
    m.rerender(card({ isExpanded: true, onReadChapter: undefined }))
    expect(toolbar()!.textContent).not.toContain('阅读原文')
  })

  it('什么操作都不提供时没有工具栏；菜单为空时不渲染「更多」', () => {
    m = mount(card({ isExpanded: true, showCopyButton: false, showReadButton: false, showViewContent: false, showClearCache: false }))
    expect(toolbar()).toBeNull()
    m.rerender(card({ isExpanded: true, showViewContent: false, showClearCache: false }))
    expect(toolbar()!.querySelector('button[aria-label="更多操作"]')).toBeNull()
  })
})
