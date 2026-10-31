/**
 * 非模态浮层：贴着锚点出现，放不下就翻到上方，永不超出视口。
 * - Esc / 点空白关闭，关闭后把焦点还给打开前的元素
 * - 悬停打开的卡片 (hover) 允许鼠标移入，由调用方用 onPointerEnter/Leave 管理关闭延迟
 * 不用 Radix Popover：项目没装，而锚点是"正文里一段文字 / 图谱里的一个节点"这类
 * 没有稳定 React 元素可挂的东西，只有一个矩形。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { placeCard, CARD_GAP, CARD_MARGIN, type AnchorRect } from './anchor'

interface FloatingCardProps {
  anchor: AnchorRect
  onClose: () => void
  label: string
  children: ReactNode
  /** 点击打开的卡片把焦点移进来（键盘可达）；悬停打开的不抢焦点 */
  takeFocus?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  className?: string
}

const WIDTH = 340

export function FloatingCard({
  anchor,
  onClose,
  label,
  children,
  takeFocus = false,
  onPointerEnter,
  onPointerLeave,
  className,
}: FloatingCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y + anchor.height + CARD_GAP })
  const returnFocus = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 先按预估宽度放，再用实测高度修正（内容变化——如展开折叠区——也会触发）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r = el.getBoundingClientRect()
      const p = placeCard(anchor, { width: r.width || WIDTH, height: r.height }, { width: window.innerWidth, height: window.innerHeight })
      setPos((prev) => (prev.left === p.left && prev.top === p.top ? prev : { left: p.left, top: p.top }))
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor])

  useEffect(() => {
    returnFocus.current = document.activeElement
    if (takeFocus) ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCloseRef.current()
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus({ preventScroll: true })
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && ref.current?.contains(target)) return
      // 点在另一个实体标注/节点上时由那边接管，这里只负责"点空白关闭"
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [takeFocus])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      tabIndex={-1}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: `min(${WIDTH}px, calc(100vw - ${CARD_MARGIN * 2}px))` }}
      className={cn(
        'z-50 max-h-[min(70vh,30rem)] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none',
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
