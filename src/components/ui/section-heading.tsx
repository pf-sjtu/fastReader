import type { LucideIcon } from 'lucide-react'
import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeadingProps {
  /** 标题文字 */
  title: ReactNode
  /** 标题前的图标（16px，自动弱化） */
  icon?: LucideIcon
  /** 标题右侧的补充说明（弱化的说明性文字） */
  hint?: ReactNode
  /** 右侧操作区（按钮等，自动右对齐） */
  action?: ReactNode
  /** 角色：`section` 分部标题（14 semibold）/ `label` 分组小标题（12 medium muted） */
  role?: 'section' | 'label'
  /** 标题标签级，默认 h3；用 div 表示只是视觉标题、不进大纲 */
  as?: ElementType
  /** 是否给整行加底部分隔线（表格前的分组标题常用） */
  bordered?: boolean
  /** 标题元素的 id（`aria-labelledby` 指向它时用） */
  id?: string
  className?: string
}

/**
 * 分部标题 / 分组小标题的统一入口（规格 design-system）。
 * 图标尺寸、间距、角色类与右侧操作区都在这里统一定死，业务处不要再手拼 `text-sm font-medium`。
 */
export function SectionHeading({
  title,
  icon: Icon,
  hint,
  action,
  role = 'section',
  as: Tag = 'h3',
  bordered,
  id,
  className
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2',
        bordered && 'border-b pb-1',
        className
      )}
    >
      <Tag id={id} className={cn('flex min-w-0 items-center gap-1.5', role === 'section' ? 't-section' : 't-label')}>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0">{title}</span>
        {hint && <span className="t-caption font-normal">{hint}</span>}
      </Tag>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  )
}

interface PanelHeaderProps {
  /** 面板标题 */
  title: ReactNode
  /** 标题前的图标 */
  icon?: LucideIcon
  /** 标题下的说明（12 muted） */
  description?: ReactNode
  /** 右上角操作区 */
  actions?: ReactNode
  /** 是否给面板头加底部分隔线 */
  bordered?: boolean
  className?: string
}

/**
 * 面板头部（标题 + 说明 + 操作）的统一入口。
 * 页签内、弹窗内、配置面板的头部都用它，避免各处自拼标题与操作区的间距。
 */
export function PanelHeader({
  title,
  icon: Icon,
  description,
  actions,
  bordered,
  className
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3',
        bordered && 'border-b pb-2',
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="t-section flex items-center gap-1.5">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0">{title}</span>
        </h3>
        {description && <p className="t-caption mt-1">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
