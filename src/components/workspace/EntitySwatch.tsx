import { cn } from '@/lib/utils'
import type { EntityShape } from '@/charts/linking/entityColors'

/** 实体的小图标：颜色 = 统一实体色，形状 = 类型（人物圆 / 组织圆角方 / 概念菱形） */
export function EntitySwatch({
  cssVar,
  shape,
  className,
}: {
  cssVar: string
  shape: EntityShape
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0',
        shape === 'circle' && 'rounded-full',
        shape === 'round-rect' && 'rounded-[3px]',
        shape === 'diamond' && 'rotate-45 rounded-[2px] scale-90',
        className
      )}
      style={{ backgroundColor: cssVar }}
    />
  )
}
