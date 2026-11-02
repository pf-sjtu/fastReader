/**
 * 状态的「语义色调」唯一映射表。
 *
 * 为什么需要它：状态徽标（批量任务、文件、分类胶囊、字体检视）与提示（一行旁注、框式警告、
 * 错误态）此前各自拼「bg-状态色/5 或 /10」+「border-状态色/30|40|50|60」+ text-*，同一语义在不同页面
 * 浓淡不一（实测淡底 8 种浓度、描边 6 种浓度），而且透明度叠加卡片底色后无法随主题自动调整。
 *
 * 现在：语义 → 类名只有这一张表，颜色全部来自语义 token（`--*-muted` 淡底、状态色本身作文字、
 * 一条固定描边档）。`StatusBadge` / `Hint` 只接受语义，不接收颜色。
 *
 * 纯模块（不引 React），便于单测与复用。
 */

/** 状态语义（与规格 specs/design-system 的 Requirement「状态徽标与提示各只有一个实现」一致） */
export const STATUS_TONES = ['neutral', 'primary', 'info', 'success', 'warning', 'danger', 'processing'] as const
export type StatusTone = (typeof STATUS_TONES)[number]

/** 业务状态 → 语义色调。新增业务状态时只改这里，不要在各处判断颜色。 */
const STATUS_TO_TONE: Record<string, StatusTone> = {
  // 批量 / 文件 / 处理流程
  pending: 'neutral',
  queued: 'neutral',
  waiting: 'neutral',
  processing: 'processing',
  running: 'processing',
  completed: 'success',
  done: 'success',
  success: 'success',
  ok: 'success',
  installed: 'success',
  skipped: 'neutral',
  failed: 'danger',
  error: 'danger',
  missing: 'warning',
  warning: 'warning',
  partial: 'warning',
  info: 'info',
  // 分类角标（src/components/library/labels.ts 的 CategoryTone）
  primary: 'primary',
  destructive: 'danger',
}

/** 淡底（容器）类：颜色来自 `--*-muted` token */
const TONE_SURFACE: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-muted text-primary',
  info: 'bg-info-muted text-info',
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  danger: 'bg-destructive-muted text-destructive',
  processing: 'bg-info-muted text-info',
}

/** 纯文字（不带底色）：用于提示旁注 */
const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  processing: 'text-info',
}

/** 带框提示：淡底 + 一条固定描边档（不再是 30/40/50/60 混用） */
const TONE_BOX: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted text-foreground',
  primary: 'border-primary/40 bg-primary-muted text-foreground',
  info: 'border-info/40 bg-info-muted text-foreground',
  success: 'border-success/40 bg-success-muted text-foreground',
  warning: 'border-warning/40 bg-warning-muted text-foreground',
  danger: 'border-destructive/40 bg-destructive-muted text-foreground',
  processing: 'border-info/40 bg-info-muted text-foreground',
}

/** 只有描边（徽标用：淡底 + 同色描边） */
const TONE_CHIP: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  primary: 'border-primary/40 bg-primary-muted text-primary',
  info: 'border-info/40 bg-info-muted text-info',
  success: 'border-success/40 bg-success-muted text-success',
  warning: 'border-warning/40 bg-warning-muted text-warning',
  danger: 'border-destructive/40 bg-destructive-muted text-destructive',
  processing: 'border-info/40 bg-info-muted text-info',
}

/** 业务状态名 → 语义色调（认不出来的按中性处理，不猜颜色） */
export function toneOf(status: string | null | undefined): StatusTone {
  const key = (status ?? '').trim().toLowerCase()
  if ((STATUS_TONES as readonly string[]).includes(key)) return key as StatusTone
  return STATUS_TO_TONE[key] ?? 'neutral'
}

export const isStatusTone = (v: string): v is StatusTone => (STATUS_TONES as readonly string[]).includes(v)

/** 徽标外观：`chip` 带框（默认）/ `surface` 只有淡底 / `text` 只有文字色 */
export function statusToneClass(tone: StatusTone, look: 'chip' | 'surface' | 'text' = 'chip'): string {
  if (look === 'text') return TONE_TEXT[tone]
  if (look === 'surface') return TONE_SURFACE[tone]
  return TONE_CHIP[tone]
}

/** 带框提示的外观（淡底 + 固定描边） */
export const hintToneClass = (tone: StatusTone): string => TONE_BOX[tone]

/** 提示文案是「旁注」还是「需要立刻注意」——决定 role（见 Hint 组件） */
export const needsAlertRole = (tone: StatusTone): boolean => tone === 'danger'

/**
 * 分类角标色调（`library/labels.ts` 的 CategoryTone）→ 语义色调。
 * 分类与状态共用一张映射表：只有「destructive ↔ danger」这一处命名差异。
 */
export function toneFromCategory(categoryTone: string): StatusTone {
  const key = categoryTone.trim().toLowerCase()
  if (key === 'destructive') return 'danger'
  if (key === 'primary') return 'primary'
  return isStatusTone(key) ? key : 'neutral'
}
