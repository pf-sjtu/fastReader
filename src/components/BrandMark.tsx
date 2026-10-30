// 咀华 品牌标识：朱砂方印（书 + 一滴精华）+ 衬线字标
// 「沉浸醲郁，含英咀华」——韩愈《进学解》：细细咀嚼文章的精华
import { useId } from 'react'
import { cn } from '@/lib/utils'

/** 印章图形；尺寸由 className 控制（默认 h-8 w-8） */
export function SealIcon({ className, title }: { className?: string; title?: string }) {
  const gradientId = useId()
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8 shrink-0', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={gradientId} cx="40%" cy="34%" r="80%">
          <stop offset="0" stopColor="#D24A33" />
          <stop offset="0.6" stopColor="#B5321F" />
          <stop offset="1" stopColor="#8C2315" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="10" fill={`url(#${gradientId})`} />
      <rect x="9.5" y="9.5" width="45" height="45" rx="6" fill="none" stroke="#F6E9DA" strokeOpacity="0.5" strokeWidth="1" />
      <path fill="#F6E9DA" d="M32 14 C32 14 27.6 19 27.6 21.8 A4.4 4.4 0 0 0 36.4 21.8 C36.4 19 32 14 32 14 Z" />
      <path fill="#F6E9DA" d="M15.5 28.5 Q23 26.2 31 29.4 V48.2 Q23.2 45.2 15.5 47.4 Z" />
      <path fill="#F6E9DA" d="M48.5 28.5 Q41 26.2 33 29.4 V48.2 Q40.8 45.2 48.5 47.4 Z" />
      <g stroke="#B5321F" strokeOpacity="0.36" strokeWidth="1" strokeLinecap="round" fill="none">
        <path d="M19 33.6 Q23.6 32.3 27.8 33.9" />
        <path d="M19 37.6 Q23.6 36.3 27.8 37.9" />
        <path d="M19 41.6 Q23 40.5 26.2 41.8" />
        <path d="M45 33.6 Q40.4 32.3 36.2 33.9" />
        <path d="M45 37.6 Q40.4 36.3 36.2 37.9" />
      </g>
    </svg>
  )
}

interface BrandMarkProps {
  /** 中文名（咀华） */
  name: string
  /** 罗马化 / 英文副标（Juhua） */
  latin?: string
  size?: 'sm' | 'lg'
  className?: string
}

/** 印章 + 字标；lg 用于首页大标题，sm 用于移动端顶栏 */
export function BrandMark({ name, latin, size = 'lg', className }: BrandMarkProps) {
  const lg = size === 'lg'
  return (
    <span className={cn('inline-flex items-center', lg ? 'gap-3' : 'gap-2', className)}>
      <SealIcon className={lg ? 'h-11 w-11' : 'h-7 w-7'} />
      <span className="flex flex-col items-start leading-none">
        <span className={cn('font-brand font-semibold text-foreground', lg ? 'text-4xl' : 'text-xl')}>{name}</span>
        {latin && (
          <span
            className={cn(
              'font-brand uppercase text-muted-foreground',
              lg ? 'mt-1.5 text-[11px] tracking-[0.42em]' : 'mt-1 text-[9px] tracking-[0.36em]'
            )}
          >
            {latin}
          </span>
        )}
      </span>
    </span>
  )
}
