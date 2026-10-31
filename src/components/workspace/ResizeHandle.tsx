/**
 * 垂直分隔条：拖动或用键盘调整侧栏宽度。
 * edge='left'（默认）：手柄在右侧栏的左缘，向左拖 = 变宽；edge='right'：手柄在左侧栏的右缘，向右拖 = 变宽。
 * 自写而非引入分栏库：只有一条分隔线，且宽度要按 px 记忆。
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  width: number
  min: number
  max: number
  onChange: (width: number) => void
  /** 双击恢复默认宽度 */
  defaultWidth?: number
  label: string
  step?: number
  /** 手柄贴着被调整栏的哪一侧 */
  edge?: 'left' | 'right'
  className?: string
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function ResizeHandle({
  width,
  min,
  max,
  onChange,
  defaultWidth,
  label,
  step = 24,
  edge = 'left',
  className,
}: ResizeHandleProps) {
  // 向"栏变宽"的方向为正：右侧栏是向左，左侧栏是向右
  const sign = edge === 'left' ? -1 : 1
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      start.current = { x: e.clientX, w: width }
      // jsdom 没有 pointer capture
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDragging(true)
    },
    [width]
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      onChange(clamp(start.current.w + sign * (e.clientX - start.current.x), min, max))
    },
    [dragging, min, max, onChange, sign]
  )

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const delta = e.shiftKey ? step * 4 : step
      let next: number | null = null
      // 右侧栏（手柄在左缘）：← 把边界往左挪 = 变宽；左侧栏相反
      if (e.key === 'ArrowLeft') next = width - sign * delta
      else if (e.key === 'ArrowRight') next = width + sign * delta
      else if (e.key === 'Home') next = min
      else if (e.key === 'End') next = max
      if (next === null) return
      e.preventDefault()
      onChange(clamp(next, min, max))
    },
    [width, min, max, step, onChange, sign]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => defaultWidth && onChange(clamp(defaultWidth, min, max))}
      className={cn(
        'group relative w-2 shrink-0 cursor-col-resize touch-none select-none outline-none',
        className
      )}
    >
      {/* 可视细线 + 更宽的命中区（w-2 本身），拖动/聚焦时加粗 */}
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-all',
          'group-hover:w-0.5 group-hover:bg-primary/50 group-focus-visible:w-0.5 group-focus-visible:bg-primary',
          dragging && 'w-0.5 bg-primary'
        )}
      />
    </div>
  )
}
