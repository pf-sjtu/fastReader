import * as React from 'react'
import { cn } from '@/lib/utils'
import { statusToneClass, toneOf, type StatusTone } from '@/utils/statusTone'

/**
 * 状态徽标：表示「状态 / 结果」的统一实现。
 *
 * 为什么不再各写各的：批量状态（队列 tab / 队列面板）、文件状态、分类胶囊、字体检视
 * 此前各自拼 bg-状态色/5 + border-状态色/30|40 + text-*，同一语义在不同页面浓淡不一。
 * 现在**语义 → 外观只有一张表**（`utils/statusTone.ts`），颜色全部来自语义 token，
 * 换主题自动跟随。
 *
 * 用法：`<StatusBadge status="completed" />` 或 `<StatusBadge tone="warning">注意</StatusBadge>`。
 */
export interface StatusBadgeProps extends React.ComponentProps<'span'> {
  /** 业务状态名（pending / completed / failed …），内部映射到语义色调 */
  status?: string
  /** 直接给语义色调（与 status 二选一；status 优先） */
  tone?: StatusTone
  /** 外观：chip（淡底+描边，默认）/ surface（只有淡底）/ text（只有文字色）/ solid（实心主色） */
  look?: 'chip' | 'surface' | 'text' | 'solid'
}

export function StatusBadge({ status, tone, look = 'chip', className, children, ...props }: StatusBadgeProps) {
  const t = tone ?? toneOf(status)
  return (
    <span
      data-slot="status-badge"
      data-tone={t}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        statusToneClass(t, look),
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
