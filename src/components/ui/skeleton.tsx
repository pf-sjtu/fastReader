import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  /** 形状：文本行（默认）/ 块（标题、图占位） */
  variant?: 'text' | 'block'
  /** 宽度（Tailwind 宽度类，如 `w-2/3`），不传则占满 */
  width?: string
  className?: string
}

/**
 * 骨架屏占位（规格 design-system）：加载态统一走这里，不要在业务组件里手写 `animate-pulse rounded-md bg-muted`。
 */
export function Skeleton({ variant = 'text', width, className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-muted',
        variant === 'text' ? 'h-4' : 'h-8',
        width,
        className
      )}
    />
  )
}

interface SkeletonTextProps {
  /** 行数（默认 3），最后一行更短，读起来更像文字 */
  lines?: number
  className?: string
}

/** 多行文字的骨架：最后一行默认 2/3 宽。 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? 'w-2/3' : undefined} />
      ))}
    </div>
  )
}

interface SkeletonListProps {
  /** 行数（默认 4） */
  rows?: number
  className?: string
  children?: ReactNode
}

/** 列表的骨架：行首圆点 + 两行文字。 */
export function SkeletonList({ rows = 4, className }: SkeletonListProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <Skeleton variant="block" className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton width="w-2/3" />
            <Skeleton width="w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
