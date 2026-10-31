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
})

const ids = ['graph', 'timeline', 'people', 'study', 'quiz', 'ask', 'overall', 'source'] as const
const tabs: DockTab[] = ids.map((id) => ({ id, label: id, content: <div>{id}</div> }))
const tabLabels = () => Array.from(mounted!.container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)
const moreBtn = () => mounted!.container.querySelector<HTMLButtonElement>('button[aria-label="更多"]')

describe('CompanionDock 页签：常驻 4 项 + 更多', () => {
  it('常驻页签直接显示，其余收进「更多」，不再横向滚动才能发现', () => {
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    expect(tabLabels()).toEqual(['graph', 'timeline', 'people', 'ask'])
    expect(moreBtn()).toBeTruthy()
    expect(mounted.container.querySelector('.overflow-x-auto')).toBeNull()
  })

  it('当前激活的非常驻页签顶替显示，保证用户始终看得到自己在哪', () => {
    mounted = mount(<CompanionDock tabs={tabs} active="source" onActiveChange={() => {}} />)
    expect(tabLabels()).toEqual(['graph', 'timeline', 'people', 'ask', 'source'])
  })

  it('「更多」菜单列出其余页签，点选即切换', async () => {
    const onActiveChange = vi.fn()
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={onActiveChange} />)
    act(() => {
      moreBtn()!.focus()
      moreBtn()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((i) => i.textContent)).toEqual(['study', 'quiz', 'overall', 'source'])
    act(() => items[3].click())
    expect(onActiveChange).toHaveBeenCalledWith('source')
  })

  it('只剩一个非常驻页签时不做菜单，全部直接展示', () => {
    const few = tabs.filter((t) => ['graph', 'timeline', 'people', 'ask', 'overall'].includes(t.id))
    mounted = mount(<CompanionDock tabs={few} active="graph" onActiveChange={() => {}} />)
    expect(tabLabels()).toEqual(['graph', 'timeline', 'people', 'ask', 'overall'])
    expect(moreBtn()).toBeNull()
  })

  it('存档里的页签不可用时回落到第一个（并显示它）', () => {
    mounted = mount(<CompanionDock tabs={tabs.slice(3)} active={'notes' as never} onActiveChange={() => {}} />)
    expect(mounted.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe('study')
  })
})
