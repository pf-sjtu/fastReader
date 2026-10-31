import '../../src/i18n'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, stubDomForRadix } from '../uiTestUtils'
import { CompanionDock, type DockTab } from '@/components/workspace/CompanionDock'

stubDomForRadix()

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

const tabs: DockTab[] = (['graph', 'timeline', 'people', 'study', 'quiz', 'ask', 'overall', 'source'] as const).map((id) => ({
  id,
  label: id,
  content: <div>{id}</div>,
}))

describe('CompanionDock 页签滚动', () => {
  it('激活页签变化时把它滚入可见区；页签栏的滚动条被隐藏', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    mounted = mount(<CompanionDock tabs={tabs} active="graph" onActiveChange={() => {}} />)
    scrollIntoView.mockClear()
    mounted.rerender(<CompanionDock tabs={tabs} active="source" onActiveChange={() => {}} />)
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' })
    const wrap = mounted.container.querySelector('.overflow-x-auto')!
    expect(wrap.className).toContain('scrollbar-width:none')
  })

  it('环境不支持 scrollIntoView 时不报错', () => {
    // @ts-expect-error 模拟旧环境
    delete Element.prototype.scrollIntoView
    expect(() => {
      mounted = mount(<CompanionDock tabs={tabs} active="ask" onActiveChange={() => {}} />)
    }).not.toThrow()
  })
})
