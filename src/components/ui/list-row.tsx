import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ListRowProps {
  /** 主文本（书名、文件名、条目名） */
  title: ReactNode
  /** 行首内容：图标、封面、序号等 */
  leading?: ReactNode
  /** 次要说明（作者、时间、大小等） */
  description?: ReactNode
  /** 行尾内容：状态徽标、操作按钮等 */
  trailing?: ReactNode
  /** 传入即为可点行（button 语义 + 悬停底色） */
  onClick?: () => void
  /** 禁用（仅对 button 语义的行生效） */
  disabled?: boolean
  /** 紧凑行高（列表密集处用） */
  dense?: boolean
  /** 选中态 */
  selected?: boolean
  /** 语义标签，默认按是否可点自动选 button / div */
  as?: ElementType
  className?: string
}

/**
 * 列表行的统一入口（规格 design-system）：行首、主次文本、行尾的排布与内边距都在这里定死。
 * 书库、批处理队列、历史、文件浏览、人物列表都用它，避免各页自拼 `flex items-center gap-2 px-2 py-1.5`。
 */
export function ListRow({
  title,
  leading,
  description,
  trailing,
  onClick,
  disabled,
  dense,
  selected,
  as,
  className
}: ListRowProps) {
  const Tag = (as ?? (onClick ? 'button' : 'div')) as ElementType
  return (
    <Tag
      {...(Tag === 'button'
        ? { type: 'button' as const, onClick, disabled, 'aria-disabled': disabled || undefined }
        : onClick
          ? { onClick }
          : {})}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md text-left',
        dense ? 'px-2 py-1' : 'px-2 py-1.5',
        (onClick || Tag === 'button') && 'transition-colors hover:bg-accent hover:text-accent-foreground',
        disabled && 'pointer-events-none opacity-50',
        selected && 'bg-accent text-accent-foreground',
        className
      )}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="t-body block truncate">{title}</span>
        {description && <span className="t-caption block truncate">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </Tag>
  )
}
