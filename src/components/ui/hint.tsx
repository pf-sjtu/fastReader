import * as React from 'react'
import { cn } from '@/lib/utils'
import { hintToneClass, needsAlertRole, statusToneClass, type StatusTone } from '@/utils/statusTone'

/**
 * 提示：统一「一行旁注」与「带框警告 / 错误」的形状。
 *
 * 为什么需要它：全站有 11 处自拼的提示——无框纯文字（`text-muted-foreground`）、
 * 框式警告（`border-warning-border bg-warning-muted`）、框式错误（`border-destructive-border bg-destructive-muted`
 * 或 `bg-card`），`role` 也随意在 `status` / `note` / 无 role 之间挑。同一句提示在不同页面
 * 浓淡与可达性都不同。
 *
 * 现在：
 * - `tone` 决定颜色（info / success / warning / danger / neutral）
 * - `boxed` 决定形状（默认纯文字旁注；需要用户注意时用带框）
 * - `role` 由语义决定：danger → `alert`（要立刻注意）；其余 → `status`（礼貌播报）；中性旁注不加 role
 */
export interface HintProps extends React.ComponentProps<'div'> {
  tone?: StatusTone
  /** 带框（默认纯文字旁注） */
  boxed?: boolean
  /** 覆盖自动的 role（一般不需要） */
  role?: React.AriaRole
}

export function Hint({ tone = 'neutral', boxed = false, role, className, children, ...props }: HintProps) {
  const autoRole: React.AriaRole | undefined = needsAlertRole(tone) ? 'alert' : tone === 'neutral' ? undefined : 'status'
  return (
    <div
      data-slot="hint"
      data-tone={tone}
      role={role ?? autoRole}
      className={cn(
        'text-sm leading-relaxed',
        boxed ? 'rounded-md border p-2.5' : undefined,
        // 颜色一律按语义给：带框用 hintToneClass（淡底 + 描边），无框用文字色。
        // （原先无框分支写死 text-muted-foreground，非中性 tone 被压成灰字——错误态看不出是错误。）
        boxed ? hintToneClass(tone) : statusToneClass(tone, 'text'),
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
