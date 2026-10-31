import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { mount } from '../uiTestUtils'
import { useChapterScrollSpy } from '@/hooks/useChapterScrollSpy'
import {
  registerScrollContainer,
  resolveScrollContainer,
  scrollContainerToChapter,
  scrollToChapterWithRetry,
} from '@/utils/scrollTo'
import {
  useReadingFocusStore,
  clampCompanionWidth,
  COMPANION_MAX_WIDTH,
  COMPANION_MIN_WIDTH,
  COMPANION_DEFAULT_WIDTH,
} from '@/stores/readingFocus'

function rect(top: number, bottom = top + 200): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function box(top: number, scrollTop = 0) {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => rect(top, top + 800)
  el.scrollTop = scrollTop
  el.scrollTo = vi.fn() as unknown as typeof el.scrollTo
  document.body.appendChild(el)
  return el
}

function chapterEl(id: string, top: number) {
  const el = document.createElement('div')
  el.id = `chapter-summary-${id}`
  el.getBoundingClientRect = () => rect(top)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  registerScrollContainer(null)
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('scrollTo 工具', () => {
  it('登记的容器优先，其次回退到 .scroll-container', () => {
    const legacy = box(0)
    legacy.className = 'scroll-container'
    expect(resolveScrollContainer()).toBe(legacy)

    const mine = box(0)
    registerScrollContainer(mine)
    expect(resolveScrollContainer()).toBe(mine)

    const explicit = box(0)
    expect(resolveScrollContainer(explicit)).toBe(explicit)
  })

  it('卸载时只清除自己登记的容器，不误清后挂载者', () => {
    const a = box(0)
    const b = box(0)
    registerScrollContainer(a)
    registerScrollContainer(b) // 新工作台已挂载
    registerScrollContainer(null, a) // 旧工作台迟到的卸载
    expect(resolveScrollContainer()).toBe(b)
    registerScrollContainer(null, b)
    expect(resolveScrollContainer()).toBeNull()
  })

  it('滚动位置 = 当前 scrollTop + 章节相对容器的偏移 - 留白', () => {
    const c = box(100, 500)
    registerScrollContainer(c)
    chapterEl('c7', 900) // 相对容器 800
    expect(scrollContainerToChapter('c7', { offset: 80 })).toBe(true)
    expect(c.scrollTo).toHaveBeenCalledWith({ top: 500 + 800 - 80, behavior: 'smooth' })
  })

  it('目标在顶部附近时不会滚成负数；目标不存在返回 false', () => {
    const c = box(0, 0)
    registerScrollContainer(c)
    chapterEl('c1', 10)
    scrollContainerToChapter('c1')
    expect(c.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(scrollContainerToChapter('nope')).toBe(false)
  })

  it('重试：200/400/600ms 各对齐一次，可取消', () => {
    vi.useFakeTimers()
    const c = box(0)
    registerScrollContainer(c)
    chapterEl('c2', 300)
    scrollToChapterWithRetry('c2')
    vi.advanceTimersByTime(650)
    expect(c.scrollTo).toHaveBeenCalledTimes(3)

    ;(c.scrollTo as ReturnType<typeof vi.fn>).mockClear()
    const cancel = scrollToChapterWithRetry('c2')
    cancel()
    vi.advanceTimersByTime(1000)
    expect(c.scrollTo).not.toHaveBeenCalled()
  })
})

describe('useChapterScrollSpy 显式容器', () => {
  function Probe(props: {
    container?: HTMLElement | null
    onChange: (id: string) => void
  }) {
    useChapterScrollSpy({
      chapterIds: ['c1', 'c2'],
      enabled: true,
      container: props.container,
      onChapterChange: props.onChange,
    })
    return null
  }

  beforeEach(() => {
    chapterEl('c1', 50)
    chapterEl('c2', 300)
  })

  it('用显式容器的顶边计算当前章（而不是全局 .scroll-container）', () => {
    const decoy = box(0)
    decoy.className = 'scroll-container' // 若误用它，锚点=96 → 选中 c1
    const mine = box(200) // 锚点=296 → c2 越过锚点
    const onChange = vi.fn()
    const m = mount(<Probe container={mine} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith('c2')
    expect(onChange).not.toHaveBeenCalledWith('c1')
    m.unmount()
  })

  it('container=null（元素未挂载）时不绑定，也不回退到选择器', () => {
    const decoy = box(0)
    decoy.className = 'scroll-container'
    const onChange = vi.fn()
    const m = mount(<Probe container={null} onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
    m.unmount()
  })

  it('元素随后挂载：重新绑定并立即解析', () => {
    const onChange = vi.fn()
    const m = mount(<Probe container={null} onChange={onChange} />)
    m.rerender(<Probe container={box(0)} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith('c1')
    m.unmount()
  })

  it('未传 container 时保持旧行为：走选择器', () => {
    const legacy = box(0)
    legacy.className = 'scroll-container'
    const onChange = vi.fn()
    const m = mount(<Probe onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith('c1')
    m.unmount()
  })
})

describe('readingFocus store', () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => {
      useReadingFocusStore.setState({
        focusedEntityId: null,
        companionTab: 'timeline',
        companionOpen: false,
        companionWidth: COMPANION_DEFAULT_WIDTH,
        focusMode: true,
      })
    })
  })

  it('focusEntity 默认展开对照栏、切到图谱并退出专注模式', () => {
    act(() => useReadingFocusStore.getState().focusEntity('ross'))
    const s = useReadingFocusStore.getState()
    expect(s).toMatchObject({
      focusedEntityId: 'ross',
      companionTab: 'graph',
      companionOpen: true,
      focusMode: false,
    })
  })

  it('reveal:false 只改聚焦，不动布局', () => {
    act(() => useReadingFocusStore.getState().focusEntity('ross', { reveal: false }))
    const s = useReadingFocusStore.getState()
    expect(s.focusedEntityId).toBe('ross')
    expect(s.companionTab).toBe('timeline')
    expect(s.companionOpen).toBe(false)
    expect(s.focusMode).toBe(true)
  })

  it('取消聚焦（null）不触发展开', () => {
    act(() => useReadingFocusStore.getState().focusEntity(null))
    expect(useReadingFocusStore.getState().companionOpen).toBe(false)
  })

  it('宽度夹在范围内，非法值回落默认', () => {
    expect(clampCompanionWidth(10)).toBe(COMPANION_MIN_WIDTH)
    expect(clampCompanionWidth(99999)).toBe(COMPANION_MAX_WIDTH)
    expect(clampCompanionWidth(Number.NaN)).toBe(COMPANION_DEFAULT_WIDTH)
    act(() => useReadingFocusStore.getState().setCompanionWidth(5000))
    expect(useReadingFocusStore.getState().companionWidth).toBe(COMPANION_MAX_WIDTH)
  })

  it('只持久化偏好：聚焦实体与专注模式不入存档', () => {
    act(() => {
      useReadingFocusStore.getState().setCompanionWidth(500)
      useReadingFocusStore.getState().focusEntity('ross')
      useReadingFocusStore.getState().toggleFocusMode()
    })
    const saved = JSON.parse(localStorage.getItem('juhua.readingFocus.v1') ?? '{}')
    expect(saved.state.companionWidth).toBe(500)
    expect(saved.state).not.toHaveProperty('focusedEntityId')
    expect(saved.state).not.toHaveProperty('focusMode')
  })

  it('localStorage 抛错（隐私模式）时界面状态仍可用', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => act(() => useReadingFocusStore.getState().setCompanionTab('people'))).not.toThrow()
    expect(useReadingFocusStore.getState().companionTab).toBe('people')
    spy.mockRestore()
  })
})
