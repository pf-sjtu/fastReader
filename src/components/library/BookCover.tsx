import { cn } from '@/lib/utils'
import { coverSlot } from './coverSlot'

interface BookCoverProps {
  title: string
  seed: string
  className?: string
}

/**
 * 生成式封面：没有真实封面时也要"像一本书"。色块取自实体色 token，
 * 书脊条 + 衬线书名；底色只占 22%，文字用前景色，保证明暗主题下的对比。
 */
export function BookCover({ title, seed, className }: BookCoverProps) {
  const color = `var(--entity-${coverSlot(seed)})`
  return (
    <div
      aria-hidden="true"
      className={cn('relative flex aspect-[3/4] w-full overflow-hidden rounded-md border bg-card shadow-sm', className)}
      style={{ background: `color-mix(in oklab, ${color} 22%, var(--card))` }}
    >
      <span className="w-2 shrink-0" style={{ background: color }} />
      <span className="font-brand flex min-w-0 flex-1 items-center px-2.5 py-3 text-sm font-semibold leading-snug text-foreground">
        <span className="line-clamp-5 break-words">{title}</span>
      </span>
    </div>
  )
}
