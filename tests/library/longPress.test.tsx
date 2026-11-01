/**
 * 手机上看书详情的入口：长按。要点是长按之后不能再触发「打开这本书」（打开 = 去 WebDAV 下载整本）。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { mount } from '../uiTestUtils'
import { useLongPress } from '@/components/library/useLongPress'

function Probe({ onLong, onClick }: { onLong: () => void; onClick: () => void }) {
  const lp = useLongPress(onLong, 500)
  return <button data-probe {...lp} onClick={onClick} />
}

let mounted: ReturnType<typeof mount> | null = null
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.useRealTimers()
})

function pointer(el: Element, type: string, pointerType: 'touch' | 'mouse' = 'touch') {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  act(() => void el.dispatchEvent(ev))
  return ev
}
const click = (el: Element) => act(() => (el as HTMLElement).click())

function setup() {
  const onLong = vi.fn()
  const onClick = vi.fn()
  mounted = mount(<Probe onLong={onLong} onClick={onClick} />)
  return { btn: mounted.container.querySelector('[data-probe]')!, onLong, onClick }
}

describe('useLongPress', () => {
  it('触摸按住满 500ms 触发长按，随后那次 click 被吞掉（不会打开书）', () => {
    const { btn, onLong, onClick } = setup()
    pointer(btn, 'pointerdown')
    act(() => void vi.advanceTimersByTime(499))
    expect(onLong).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(2))
    expect(onLong).toHaveBeenCalledTimes(1)
    pointer(btn, 'pointerup')
    click(btn) // 抬手后浏览器补发的 click
    expect(onClick).not.toHaveBeenCalled()
    click(btn) // 吞一次就够：之后的正常点击恢复
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('没按满就抬起 / 移出 / 取消（比如开始滚动）：不触发，正常点击照常生效', () => {
    // React 的 onPointerLeave 由 pointerout 合成（relatedTarget 为空 = 移出了窗口 / 元素）
    for (const end of ['pointerup', 'pointerout', 'pointercancel']) {
      const { btn, onLong, onClick } = setup()
      pointer(btn, 'pointerdown')
      act(() => void vi.advanceTimersByTime(300))
      pointer(btn, end)
      act(() => void vi.advanceTimersByTime(1000))
      expect(onLong, end).not.toHaveBeenCalled()
      click(btn)
      expect(onClick, end).toHaveBeenCalledTimes(1)
      mounted!.unmount()
    }
  })

  it('鼠标不触发长按（鼠标有悬浮卡和详情按钮）', () => {
    const { btn, onLong } = setup()
    pointer(btn, 'pointerdown', 'mouse')
    act(() => void vi.advanceTimersByTime(2000))
    expect(onLong).not.toHaveBeenCalled()
  })

  it('长按触发后抑制系统上下文菜单；平时不干预右键', () => {
    const { btn } = setup()
    const normal = new Event('contextmenu', { bubbles: true, cancelable: true })
    act(() => void btn.dispatchEvent(normal))
    expect(normal.defaultPrevented).toBe(false)
    pointer(btn, 'pointerdown')
    act(() => void vi.advanceTimersByTime(600))
    const afterLong = new Event('contextmenu', { bubbles: true, cancelable: true })
    act(() => void btn.dispatchEvent(afterLong))
    expect(afterLong.defaultPrevented).toBe(true)
  })

  it('重复按下会重置计时（不会因为上一次残留的计时器提前触发）', () => {
    const { btn, onLong } = setup()
    pointer(btn, 'pointerdown')
    act(() => void vi.advanceTimersByTime(400))
    pointer(btn, 'pointerdown')
    act(() => void vi.advanceTimersByTime(400))
    expect(onLong).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(150))
    expect(onLong).toHaveBeenCalledTimes(1)
  })
})
