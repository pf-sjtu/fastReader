import { useLayoutEffect, useState, type RefObject } from 'react'

/** 最近的可滚动容器：对照栏每个页签的内容区 */
const SCROLLER_SELECTOR = '[data-slot="tabs-content"]'

const outerHeight = (el: Element) => {
  const s = getComputedStyle(el)
  return (el as HTMLElement).offsetHeight + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0)
}

/**
 * 让一个元素刚好填满「它所在的滚动容器」剩下的高度：
 *   高度 = 容器可视高度 − 元素上方已占的高度 − 元素下方（含祖先链上）所有后续兄弟的高度 − 容器底内边距
 * 画布 / 时间线下面还有图例、提示行，它们的高度随内容变化，写死 calc(100dvh - Nrem) 只能估，估大了就出滚动条、估小了就留白。
 *
 * 返回 null = 量不出来（不在 tabs-content 里 / 还没布局 / jsdom）：调用方用 CSS 兜底高度。
 * 容器大小、后续兄弟的大小或结构变化都会重算；隐藏的页签（display:none）在重新显示时自动重算。
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, min = 280): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const scroller = el?.closest<HTMLElement>(SCROLLER_SELECTOR)
    if (!el || !scroller || typeof ResizeObserver === 'undefined') return

    /** 元素下方所有后续兄弟（沿祖先链一路到滚动容器为止） */
    const followers = () => {
      const out: Element[] = []
      for (let n: Element | null = el; n && n !== scroller; n = n.parentElement) {
        for (let s = n.nextElementSibling; s; s = s.nextElementSibling) out.push(s)
      }
      return out
    }

    const compute = () => {
      if (!scroller.clientHeight) return // display:none 或还没布局
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const after = followers().reduce((n, f) => n + outerHeight(f), 0)
      const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      const marginBottom = parseFloat(getComputedStyle(el).marginBottom) || 0
      // 再留 1px：亚像素取整误差会让内容刚好比容器高一点点，仍然冒出滚动条
      const next = Math.max(min, Math.floor(scroller.clientHeight - top - after - padBottom - marginBottom - 1))
      setHeight((prev) => (prev === next ? prev : next))
    }

    const ro = new ResizeObserver(compute)
    const observe = () => {
      ro.disconnect()
      ro.observe(scroller)
      followers().forEach((f) => ro.observe(f))
    }
    observe()
    compute()

    // 图例增删、条件渲染的块出现 / 消失：重新挂观察并重算（合并到下一帧，避免连环触发）
    let raf = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        observe()
        compute()
      })
    })
    mo.observe(scroller, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(raf)
      mo.disconnect()
      ro.disconnect()
    }
  }, [ref, min])

  return height
}
