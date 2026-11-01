import { describe, it, expect, afterEach } from 'vitest'
import { useRef } from 'react'
import { mount, stubDomForRadix } from '../uiTestUtils'
import { useFillHeight } from '@/hooks/useFillHeight'

stubDomForRadix()

let mounted: ReturnType<typeof mount> | null = null
const restores: (() => void)[] = []
afterEach(() => {
  mounted?.unmount()
  mounted = null
  // 断言失败时也要恢复原型桩，免得泄漏到后面的用例
  while (restores.length) restores.pop()!()
})

/** 被测元素放在 tabs-content 里，后面跟着一个 wrapper 内的兄弟（图例）和一个祖先层的兄弟（提示行） */
function Probe({ min }: { min?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const h = useFillHeight(ref, min)
  return (
    <div data-slot="tabs-content" data-testid="scroller">
      <div data-testid="wrapper">
        <div data-testid="toolbar" />
        <div ref={ref} data-testid="canvas" data-h={h ?? 'null'} />
        <div data-testid="legend" />
      </div>
      <p data-testid="hint" />
    </div>
  )
}

const rect = (top: number) => ({ top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
/** 用原型级的桩按 data-testid 分发几何数据（jsdom 不做布局），再挂载：hook 在挂载时就会算一次 */
function mountWithGeometry(geo: { scrollerH: number; scrollerTop: number; canvasTop: number; legendH: number; hintH: number; scrollTop?: number }, min?: number) {
  const byId = (el: Element) => (el as HTMLElement).dataset.testid
  const heights: Record<string, number> = { legend: geo.legendH, hint: geo.hintH }
  const protoClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  const protoOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  const protoScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  const protoRect = Element.prototype.getBoundingClientRect
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return byId(this) === 'scroller' ? (geo.scrollTop ?? 0) : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return byId(this) === 'scroller' ? geo.scrollerH : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return heights[byId(this) ?? ''] ?? 0 } })
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const id = byId(this)
    return rect(id === 'scroller' ? geo.scrollerTop : id === 'canvas' ? geo.canvasTop : 0)
  }
  const restore = () => {
    if (protoClient) Object.defineProperty(HTMLElement.prototype, 'clientHeight', protoClient)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    if (protoOffset) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', protoOffset)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
    if (protoScroll) Object.defineProperty(Element.prototype, 'scrollTop', protoScroll)
    else delete (Element.prototype as unknown as Record<string, unknown>).scrollTop
    Element.prototype.getBoundingClientRect = protoRect
  }
  restores.push(restore)
  mounted = mount(<Probe min={min} />)
  return { read: () => mounted!.container.querySelector('[data-testid="canvas"]')!.getAttribute('data-h') }
}

describe('useFillHeight', () => {
  it('高度 = 容器可视高度 − 上方占用 − 下方兄弟（含祖先层）− 1', () => {
    const g = mountWithGeometry({ scrollerH: 600, scrollerTop: 100, canvasTop: 148, legendH: 90, hintH: 24 })
    // 上方 48；下方 90 + 24 = 114；600 − 48 − 114 − 1 = 437
    expect(g.read()).toBe('437')
  })

  it('页签内容区已滚动时，上方占用按内容坐标算（不受 scrollTop 影响结果）', () => {
    // 视口里 canvas 的 top 比容器 top 小 40（已滚走 40px）→ 内容坐标里仍是 48
    const g = mountWithGeometry({ scrollerH: 600, scrollerTop: 100, canvasTop: 108, legendH: 90, hintH: 24, scrollTop: 40 })
    expect(g.read()).toBe('437')
  })

  it('不低于最小高度：容器很矮时也保证画布可用', () => {
    const g = mountWithGeometry({ scrollerH: 200, scrollerTop: 0, canvasTop: 50, legendH: 90, hintH: 24 }, 280)
    expect(g.read()).toBe('280')
  })

  it('量不出来（容器没有高度：未布局 / display:none）返回 null，调用方用 CSS 兜底', () => {
    mounted = mount(<Probe />)
    expect(mounted.container.querySelector('[data-testid="canvas"]')!.getAttribute('data-h')).toBe('null')
  })

  it('不在 tabs-content 里：返回 null', () => {
    function Bare() {
      const ref = useRef<HTMLDivElement>(null)
      const h = useFillHeight(ref)
      return <div ref={ref} data-h={h ?? 'null'} />
    }
    mounted = mount(<Bare />)
    expect(mounted.container.firstElementChild!.getAttribute('data-h')).toBe('null')
  })
})
