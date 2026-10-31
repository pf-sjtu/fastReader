import '../../src/i18n'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import i18n from '../../src/i18n'
import { mount, pressKey, click, stubDomForRadix } from '../uiTestUtils'
import { ResizeHandle } from '@/components/workspace/ResizeHandle'
import { CompanionDock, type DockTab } from '@/components/workspace/CompanionDock'

stubDomForRadix()

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

const sep = () => document.querySelector('[role="separator"]') as HTMLElement

describe('ResizeHandle', () => {
  function setup(width = 400) {
    const onChange = vi.fn()
    mounted = mount(
      <ResizeHandle width={width} min={280} max={760} defaultWidth={440} onChange={onChange} label="调整宽度" />
    )
    return onChange
  }

  it('暴露 separator 语义与当前宽度', () => {
    setup(400)
    expect(sep().getAttribute('aria-orientation')).toBe('vertical')
    expect(sep().getAttribute('aria-valuenow')).toBe('400')
    expect(sep().getAttribute('aria-valuemin')).toBe('280')
    expect(sep().getAttribute('aria-valuemax')).toBe('760')
    expect(sep().getAttribute('aria-label')).toBe('调整宽度')
    expect(sep().tabIndex).toBe(0)
  })

  it('← 变宽、→ 变窄（手柄在栏的左缘），Shift 步长 ×4', () => {
    const onChange = setup(400)
    pressKey(sep(), 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(424)
    pressKey(sep(), 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(376)
    act(() => {
      sep().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(400 + 24 * 4)
  })

  it('Home/End 到最值，越界时夹在范围内', () => {
    const onChange = setup(750)
    pressKey(sep(), 'Home')
    expect(onChange).toHaveBeenLastCalledWith(280)
    pressKey(sep(), 'End')
    expect(onChange).toHaveBeenLastCalledWith(760)
    pressKey(sep(), 'ArrowLeft') // 750 + 24 → 夹到 760
    expect(onChange).toHaveBeenLastCalledWith(760)
  })

  it('无关按键不处理（不吞掉 Tab 等）', () => {
    const onChange = setup()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      sep().dispatchEvent(ev)
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('双击恢复默认宽度', () => {
    const onChange = setup(600)
    act(() => {
      sep().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(440)
  })

  it('指针拖动：向左拖变宽、向右拖变窄，松开后不再响应', () => {
    const onChange = setup(400)
    const fire = (type: string, clientX: number) =>
      act(() => {
        sep().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }))
      })
    fire('pointerdown', 500)
    fire('pointermove', 450) // 向左 50 → +50
    expect(onChange).toHaveBeenLastCalledWith(450)
    fire('pointermove', 560) // 向右 60 → -60
    expect(onChange).toHaveBeenLastCalledWith(340)
    fire('pointermove', -2000) // 极端：夹到 max
    expect(onChange).toHaveBeenLastCalledWith(760)
    fire('pointerup', 0)
    onChange.mockClear()
    fire('pointermove', 100)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('没有按下就移动不会改变宽度', () => {
    const onChange = setup()
    act(() => {
      sep().dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10 }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CompanionDock', () => {
  const makeTabs = (): DockTab[] => [
    { id: 'graph', label: '图谱', keepMounted: true, content: <div data-testid="graph">G</div> },
    { id: 'timeline', label: '时间线', keepMounted: true, content: <div data-testid="timeline">T</div> },
    { id: 'overall', label: '综述', content: <div data-testid="overall">O</div> },
  ]
  const has = (id: string) => !!document.querySelector(`[data-testid="${id}"]`)
  const visible = (id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`)
    return !!el && !el.closest('.hidden')
  }
  const tab = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === label)!

  it('只展示当前页签；keepMounted 的页签切走后仍保持挂载（仅隐藏）', () => {
    mounted = mount(<CompanionDock tabs={makeTabs()} active="graph" onActiveChange={() => {}} />)
    expect(visible('graph')).toBe(true)
    expect(has('timeline')).toBe(true) // 保活
    expect(visible('timeline')).toBe(false)
    expect(has('overall')).toBe(false) // 普通页签：未激活就不挂载
  })

  it('切到普通页签后，图谱依然挂载（不用重新布局）', () => {
    mounted = mount(<CompanionDock tabs={makeTabs()} active="overall" onActiveChange={() => {}} />)
    expect(visible('overall')).toBe(true)
    expect(has('graph')).toBe(true)
    expect(visible('graph')).toBe(false)
  })

  it('点击页签触发 onActiveChange', () => {
    const onChange = vi.fn()
    mounted = mount(<CompanionDock tabs={makeTabs()} active="graph" onActiveChange={onChange} />)
    act(() => {
      tab('综述').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    expect(onChange).toHaveBeenCalledWith('overall')
  })

  it('存档里的页签在当前书里不存在时回落到第一个', () => {
    mounted = mount(<CompanionDock tabs={makeTabs()} active="notes" onActiveChange={() => {}} />)
    expect(visible('graph')).toBe(true)
    expect(tab('图谱').getAttribute('aria-selected')).toBe('true')
  })

  it('提供 onCollapse 时才显示收起按钮，且可点击', () => {
    const onCollapse = vi.fn()
    mounted = mount(<CompanionDock tabs={makeTabs()} active="graph" onActiveChange={() => {}} />)
    expect(document.querySelector(`[aria-label="${i18n.t('workspace.dock.collapse')}"]`)).toBeNull()
    mounted.rerender(<CompanionDock tabs={makeTabs()} active="graph" onActiveChange={() => {}} onCollapse={onCollapse} />)
    click(document.querySelector(`[aria-label="${i18n.t('workspace.dock.collapse')}"]`))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('没有页签时不渲染', () => {
    mounted = mount(<CompanionDock tabs={[]} active="graph" onActiveChange={() => {}} />)
    expect(mounted.container.innerHTML).toBe('')
  })
})
