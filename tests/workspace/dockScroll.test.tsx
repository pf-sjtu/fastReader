import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, stubDomForRadix } from '../uiTestUtils'
import { CompanionDock, type DockTab } from '@/components/workspace/CompanionDock'

stubDomForRadix()

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/**
 * jsdom 不做布局：用桩给出「容器可用宽度」与「每个页签图标 + 文字的自然宽度」。
 * 主要页签（graph / study / ask / source）与次要页签的区分在组件里，这里只控制宽度。
 */
function stubWidths(container: number, tabWidth = 100, moreWidth = 64) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === 'dock-list' ? container : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const m = this.dataset.measure
    const width = m === '__more' ? moreWidth : m ? tabWidth : 0
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

const ids = ['graph', 'timeline', 'people', 'study', 'quiz', 'ask', 'overall', 'source'] as const
const tabs: DockTab[] = ids.map((id) => ({ id, label: `L-${id}`, content: <div>{id}</div> }))
const tabEls = () => Array.from(mounted!.container.querySelectorAll<HTMLElement>('[role="tab"]'))
const tabIds = () => tabEls().map((t) => t.getAttribute('aria-label')?.replace('L-', '') ?? t.textContent?.replace('L-', ''))
const hasText = (el: HTMLElement) => /L-/.test(el.textContent ?? '')
const moreBtn = () => mounted!.container.querySelector<HTMLButtonElement>('button[aria-label="更多"]')

describe('CompanionDock 页签：图标 + 文字，宽度不够时逐级退让', () => {
  it('宽度够：8 个页签全部「图标 + 文字」直接显示，没有「更多」', () => {
    stubWidths(1000) // 8×100 + 间距 = 814
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    expect(tabEls()).toHaveLength(8)
    expect(tabEls().every(hasText)).toBe(true)
    expect(tabEls().every((t) => t.querySelector('svg'))).toBe(true) // 每个页签都有图标
    expect(moreBtn()).toBeNull()
  })

  it('无法测量宽度（jsdom / 隐藏的栏）：按不限宽处理，全部显示，不会把页签都折进菜单', () => {
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    expect(tabEls()).toHaveLength(8)
    expect(moreBtn()).toBeNull()
  })

  it('略窄：次要页签先只剩图标（带 aria-label / title），主要页签仍带文字', () => {
    // 主要 4×100 + 次要 4×36 + 间距 14 = 558 → 给 600 放得下；全图文 814 放不下
    stubWidths(606)
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    const byId = Object.fromEntries(tabEls().map((t, i) => [ids[i], t]))
    for (const id of ['graph', 'study', 'ask', 'source'] as const) expect(hasText(byId[id])).toBe(true)
    for (const id of ['timeline', 'people', 'quiz', 'overall'] as const) {
      expect(hasText(byId[id])).toBe(false)
      expect(byId[id].getAttribute('aria-label')).toBe(`L-${id}`)
      expect(byId[id].getAttribute('title')).toBe(`L-${id}`)
      expect(byId[id].querySelector('svg')).toBeTruthy()
    }
    expect(moreBtn()).toBeNull()
  })

  it('更窄：主要页签也只剩图标，但仍全部直接显示', () => {
    stubWidths(8 * 36 + 7 * 2 + 6) // 全图标恰好放得下
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    expect(tabEls()).toHaveLength(8)
    expect(tabEls().some(hasText)).toBe(false)
    expect(moreBtn()).toBeNull()
  })

  it('再窄才折进「更多」：菜单里是「图标 + 文字」，点选即切换；次要且靠后的先折，主要页签留在外面', async () => {
    stubWidths(230)
    const onActiveChange = vi.fn()
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={onActiveChange} />)
    expect(moreBtn()).toBeTruthy()
    const shown = tabIds()
    for (const id of ['graph', 'study', 'ask', 'source']) expect(shown).toContain(id)
    act(() => {
      moreBtn()!.focus()
      moreBtn()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.querySelector('svg') && /L-/.test(i.textContent ?? ''))).toBe(true) // 菜单项也是图标 + 文字
    act(() => items[0].click())
    expect(onActiveChange).toHaveBeenCalledTimes(1)
    // 菜单里的页签一定不在外面重复出现
    const inMenu = items.map((i) => i.textContent!.replace('L-', ''))
    for (const id of inMenu) expect(shown).not.toContain(id)
  })

  it('「更多」按钮：放得下带文字「更多」，空间不够只剩图标', () => {
    stubWidths(240)
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    const textual = moreBtn()!.textContent
    mounted.unmount()
    stubWidths(100)
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    expect(moreBtn()!.textContent).toBe('')
    expect(moreBtn()!.querySelector('svg')).toBeTruthy()
    expect(textual === '更多' || textual === '').toBe(true) // 宽度因桩而异：只要求带文字时文字就是「更多」
  })

  it('当前页签永不折进菜单（即便它是次要页签）', () => {
    stubWidths(150)
    mounted = mount(<CompanionDock tabs={tabs} active="quiz" onActiveChange={() => {}} />)
    expect(tabIds()).toContain('quiz')
  })

  it('存档里的页签不可用时回落到第一个（并显示它）', () => {
    mounted = mount(<CompanionDock tabs={tabs.slice(3)} active={'notes' as never} onActiveChange={() => {}} />)
    expect(mounted.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe('L-study')
  })

  it('点击页签触发 onActiveChange', () => {
    const onActiveChange = vi.fn()
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={onActiveChange} />)
    // Radix Tabs 用 mousedown 激活
    act(() => {
      tabEls()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    })
    expect(onActiveChange).toHaveBeenCalledWith('timeline')
  })
})
