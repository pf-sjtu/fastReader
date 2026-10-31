import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, pressKey, click } from '../uiTestUtils'
import { ResizeHandle } from '@/components/workspace/ResizeHandle'
import { NavRail, MAX_RAIL_DOTS } from '@/components/workspace/NavRail'
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

describe('NavRail（折叠后的纵向圆点进度条）', () => {
  const chs = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, title: `第${i + 1}章` }))
  const dots = () => Array.from(document.querySelectorAll<HTMLElement>('ol > li'))
  const fill = () => document.querySelector<HTMLElement>('[data-testid="rail-fill"]')!

  it('只有一条窄轨道：每章一个点；读过的点亮、当前章高亮、其余空心；没有文字和图标按钮', () => {
    mounted = mount(<NavRail chapters={chs} current={3} onExpand={() => {}} />)
    expect(dots().map((d) => d.getAttribute('data-state'))).toEqual(['read', 'read', 'current', 'todo', 'todo', 'todo', 'todo', 'todo'])
    expect(dots()[2].title).toBe('第3章')
    expect(mounted.container.textContent).toBe('') // 不显示 3/8 之类文字
    expect(mounted.container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('进度线填充到当前章所在位置；progressbar 语义完整', () => {
    mounted = mount(<NavRail chapters={chs} current={3} onExpand={() => {}} />)
    expect(fill().style.height).toBe(`${(2 / 7) * 100}%`)
    const bar = document.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('8')
    expect(bar.getAttribute('aria-valuetext')).toBe('3/8')
  })

  it('整条可点击展开（铺满的按钮），按钮不嵌套在 progressbar 里', () => {
    const onExpand = vi.fn()
    mounted = mount(<NavRail chapters={chs} current={1} onExpand={onExpand} />)
    const btn = mounted.container.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('展开目录')
    expect(btn.closest('[role="progressbar"]')).toBeNull()
    click(btn)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('边界：未定位=0%；最后一章=100%；只有一章；章节过多只画线不画点', () => {
    mounted = mount(<NavRail chapters={chs} current={0} onExpand={() => {}} />)
    expect(fill().style.height).toBe('0%')
    expect(dots().every((d) => d.getAttribute('data-state') === 'todo')).toBe(true)
    mounted.rerender(<NavRail chapters={chs} current={8} onExpand={() => {}} />)
    expect(fill().style.height).toBe('100%')
    mounted.rerender(<NavRail chapters={chs.slice(0, 1)} current={1} onExpand={() => {}} />)
    expect(fill().style.height).toBe('100%')
    const many = Array.from({ length: MAX_RAIL_DOTS + 1 }, (_, i) => ({ id: `x${i}`, title: `${i}` }))
    mounted.rerender(<NavRail chapters={many} current={5} onExpand={() => {}} />)
    expect(dots()).toHaveLength(0)
    expect(fill().style.height).not.toBe('0%')
  })

  it('没有章节时不报错、不出现 NaN', () => {
    mounted = mount(<NavRail chapters={[]} current={0} onExpand={() => {}} />)
    expect(fill().style.height).toBe('0%')
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
