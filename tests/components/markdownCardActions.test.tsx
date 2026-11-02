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
beforeEach(() => {
  // onExpandChange 是模块级的 vi.fn()，调用会跨用例累积——每个用例前清空，
  // 否则「点工具不误触折叠」会被上一个用例点整行的调用误判为失败
  vi.clearAllMocks()
})
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

/**
 * 工具行现在在**标题行右侧**（不是展开后单独占一行）：
 * 收起时也能看到有哪些操作，标题行更紧凑（原先「复制 / 阅读原文 / …」把正文往下挤了一整行）。
 */
describe('MarkdownCard：标题行右侧就是工具区', () => {
  it('收起时工具区已经在标题行里（不必展开才看得到操作）', () => {
    m = mount(card())
    expect(toolbar()).not.toBeNull()
    const labels = Array.from(toolbar()!.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.textContent?.trim())
    expect(labels).toEqual(['复制', '阅读原文', '更多操作'])
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('工具区与标题在同一个头部行里（工具不再单独占一行）', () => {
    m = mount(card({ isExpanded: true }))
    const header = toolbar()!.parentElement!
    // 工具区与折叠箭头同在一个 flex 容器内（父级才是头部行）
    expect(header.querySelector('button[aria-expanded]')).not.toBeNull()
    expect(header.className).toContain('items-start')
    // 工具区不再单独占一行：它的父级就是头部行本身（不是内容区）
    expect(header.className).not.toContain('markdown-card-content')
  })

  it('标题完整、带序号；点整行切换展开（受控模式回调带章节 id）；读屏名称含标题', () => {
    m = mount(card())
    expect(toggle().textContent).toContain('第一章 从标牌到纳贝斯克')
    expect(toggle().textContent).toContain('01')
    click(toggle())
    expect(onExpandChange).toHaveBeenCalledWith(true, 'c1')
    expect(toggle().getAttribute('aria-label')).toContain('第一章 从标牌到纳贝斯克')
  })

  it('点工具不会误触折叠（工具区 stopPropagation）', () => {
    const onReadChapter = vi.fn()
    m = mount(card({ onReadChapter }))
    click(Array.from(toolbar()!.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '阅读原文'))
    expect(onReadChapter).toHaveBeenCalledWith('c1')
    expect(onExpandChange).not.toHaveBeenCalled()
  })

  it('showIndex=false（全书关联/总结这类单张卡）不显示序号', () => {
    m = mount(card({ showIndex: false }))
    expect(toggle().textContent).not.toContain('01')
  })
})

describe('MarkdownCard：工具区内容', () => {
  it('工具区三项都在，用纯图标按钮（带 aria-label，不占文字宽度）', () => {
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
    click(Array.from(toolbar()!.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '阅读原文'))
    expect(onReadChapter).toHaveBeenCalledWith('c1')
    m.rerender(card({ isExpanded: true, onReadChapter: undefined }))
    expect(toolbar()!.textContent).not.toContain('阅读原文')
  })

  it('什么操作都不提供时没有工具区；菜单为空时不渲染「更多」', () => {
    m = mount(card({ isExpanded: true, showCopyButton: false, showReadButton: false, showViewContent: false, showClearCache: false }))
    expect(toolbar()).toBeNull()
    m.rerender(card({ isExpanded: true, showViewContent: false, showClearCache: false }))
    expect(toolbar()!.querySelector('button[aria-label="更多操作"]')).toBeNull()
  })
})
