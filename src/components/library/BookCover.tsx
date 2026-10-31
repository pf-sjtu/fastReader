import { cn } from '@/lib/utils'
import { coverSlot, monogramOf } from './coverSlot'

interface BookCoverProps {
  /** 只用来取装饰用的首字；书名文字由卡片底部的阴影层统一承载，避免和真实封面一样重复印两遍 */
  title: string
  seed: string
  className?: string
}

/**
 * 生成式封面：没有真实封面时也要像一本书——
 * 实体色渐变 + 左侧书脊（带高光线）+ 大号衬线首字做肌理 + 内描边。
 * 不放书名：文字交给底部阴影层，与真实封面完全一致。
 */
export function BookCover({ title, seed, className }: BookCoverProps) {
  const c = `var(--entity-${coverSlot(seed)})`
  return (
    <div
      aria-hidden="true"
      className={cn('relative size-full overflow-hidden', className)}
      style={{
        background: `linear-gradient(155deg, color-mix(in oklab, ${c} 82%, white) 0%, ${c} 38%, color-mix(in oklab, ${c} 55%, black) 100%)`,
      }}
    >
      {/* 书脊 */}
      <span
        className="absolute inset-y-0 left-0 w-[7%] min-w-1.5"
        style={{
          background: `linear-gradient(90deg, color-mix(in oklab, ${c} 50%, black), color-mix(in oklab, ${c} 78%, black))`,
          boxShadow: 'inset -1px 0 0 rgb(255 255 255 / 0.22)',
        }}
      />
      {/* 首字肌理 */}
      <span className="font-brand pointer-events-none absolute right-[10%] top-[8%] select-none text-[5.5rem] font-bold leading-none text-white/20">
        {monogramOf(title)}
      </span>
      {/* 内描边 */}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/15" />
    </div>
  )
}
