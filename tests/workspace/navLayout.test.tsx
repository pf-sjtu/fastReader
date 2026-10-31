import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, pressKey, click } from '../uiTestUtils'
import { ResizeHandle } from '@/components/workspace/ResizeHandle'
import { NavRail } from '@/components/workspace/NavRail'
import {
  useReadingFocusStore,
  clampNavWidth,
  NAV_DEFAULT_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
} from '@/stores/readingFocus'

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
})

const sep = () => document.querySelector('[role="separator"]') as HTMLElement

describe('ResizeHandle edge="right"（左侧目录栏：手柄在栏的右缘）', () => {
  function setup(width = 208) {
    const onChange = vi.fn()
    mounted = mount(
      <ResizeHandle
        edge="right"
        width={width}
        min={NAV_MIN_WIDTH}
        max={NAV_MAX_WIDTH}
        defaultWidth={NAV_DEFAULT_WIDTH}
        step={16}
        onChange={onChange}
        label="调整目录宽度"
      />
    )
    return onChange
  }
  const fire = (type: string, clientX: number) =>
    act(() => {
      sep().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }))
    })

  it('→ 变宽、← 变窄', () => {
    const onChange = setup(208)
    pressKey(sep(), 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(224)
    pressKey(sep(), 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(192)
  })

  it('指针向右拖变宽、向左拖变窄，且夹在 160–360', () => {
    const onChange = setup(208)
    fire('pointerdown', 300)
    fire('pointermove', 340) // 向右 40
    expect(onChange).toHaveBeenLastCalledWith(248)
    fire('pointermove', 250) // 向左 50
    expect(onChange).toHaveBeenLastCalledWith(NAV_MIN_WIDTH) // 208-50=158 → 夹到 160
    fire('pointermove', 5000)
    expect(onChange).toHaveBeenLastCalledWith(NAV_MAX_WIDTH)
    fire('pointerup', 0)
  })

  it('双击恢复默认宽度', () => {
    const onChange = setup(330)
    act(() => {
      sep().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(NAV_DEFAULT_WIDTH)
  })
})

describe('NavRail', () => {
  it('以 progressbar 语义暴露阅读进度，点按钮展开目录', () => {
    const onExpand = vi.fn()
    mounted = mount(<NavRail current={3} total={8} onExpand={onExpand} />)
    const bar = document.querySelector('[role="progressbar"]') as HTMLElement
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('8')
    expect((bar.firstElementChild as HTMLElement).style.height).toBe('37.5%')
    expect(mounted.container.textContent).toContain('3/8')
    click(mounted.container.querySelector('button'))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('总数为 0 时不出现 NaN 宽度', () => {
    mounted = mount(<NavRail current={0} total={0} onExpand={() => {}} />)
    const bar = document.querySelector('[role="progressbar"]') as HTMLElement
    expect((bar.firstElementChild as HTMLElement).style.height).toBe('0%')
  })

  it('进度不会超过 100%', () => {
    mounted = mount(<NavRail current={9} total={8} onExpand={() => {}} />)
    const bar = document.querySelector('[role="progressbar"]') as HTMLElement
    expect((bar.firstElementChild as HTMLElement).style.height).toBe('100%')
  })
})

describe('目录栏状态（store）', () => {
  beforeEach(() => {
    useReadingFocusStore.setState({ navWidth: NAV_DEFAULT_WIDTH, navCollapsed: false })
  })

  it('clampNavWidth：夹范围、取整、非法值回默认', () => {
    expect(clampNavWidth(100)).toBe(NAV_MIN_WIDTH)
    expect(clampNavWidth(999)).toBe(NAV_MAX_WIDTH)
    expect(clampNavWidth(200.6)).toBe(201)
    expect(clampNavWidth(Number.NaN)).toBe(NAV_DEFAULT_WIDTH)
  })

  it('setNavWidth 写入前夹取；setNavCollapsed 切换折叠', () => {
    useReadingFocusStore.getState().setNavWidth(9999)
    expect(useReadingFocusStore.getState().navWidth).toBe(NAV_MAX_WIDTH)
    useReadingFocusStore.getState().setNavCollapsed(true)
    expect(useReadingFocusStore.getState().navCollapsed).toBe(true)
  })

  it('折叠态与宽度被持久化；专注模式（会话态）不持久化', () => {
    useReadingFocusStore.getState().setNavWidth(280)
    useReadingFocusStore.getState().setNavCollapsed(true)
    useReadingFocusStore.setState({ focusMode: true })
    const saved = JSON.parse(localStorage.getItem('juhua.readingFocus.v1') ?? '{}')
    expect(saved.state.navWidth).toBe(280)
    expect(saved.state.navCollapsed).toBe(true)
    expect(saved.state.focusMode).toBeUndefined()
    useReadingFocusStore.setState({ focusMode: false })
  })
})
