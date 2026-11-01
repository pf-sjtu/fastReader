// 设置 → 字体：列出各角色的字体优先级、是否已安装、当前实际生效的是哪个
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Minus, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/components/ui/section-heading'
import { cn } from '@/lib/utils'
import { useReadingFocusStore, type ReadingFont } from '@/stores/readingFocus'
import { canvasMeasure, checkStack, parseFontStack, type FontStatus, type MeasureFn, type StackReport } from '@/utils/fontCheck'

const ROLES = [
  { id: 'sans', cssVar: '--font-sans', labelKey: 'config.fonts.roles.sans' },
  { id: 'serif', cssVar: '--font-serif', labelKey: 'config.fonts.roles.serif' },
  { id: 'mono', cssVar: '--font-mono', labelKey: 'config.fonts.roles.mono' },
] as const

/** 字体栈的唯一来源是 index.css 里的 CSS 变量，这里只读不写 */
const readStack = (cssVar: string) => parseFontStack(getComputedStyle(document.documentElement).getPropertyValue(cssVar))

const STATUS_ICON: Record<FontStatus, typeof Check> = { installed: Check, missing: X, generic: Minus, unknown: Minus }
const STATUS_TONE: Record<FontStatus, string> = {
  installed: 'text-success',
  missing: 'text-muted-foreground',
  generic: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
}

function StackList({ report }: { report: StackReport }) {
  const { t } = useTranslation()
  return (
    <ol className="space-y-1 text-sm">
      {report.items.map((item, i) => {
        const Icon = STATUS_ICON[item.status]
        const isActive = item.name === report.active
        return (
          <li key={item.name} data-status={item.status} className={cn('flex items-center gap-2 rounded-md px-2 py-1', isActive && 'bg-accent')}>
            <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate" style={item.status === 'installed' ? { fontFamily: `"${item.name}"` } : undefined}>
              {item.name}
            </span>
            {isActive && <span className="shrink-0 rounded-md bg-primary px-1.5 text-xs text-primary-foreground">{t('config.fonts.active')}</span>}
            <span className={cn('flex shrink-0 items-center gap-1 text-xs', STATUS_TONE[item.status])}>
              <Icon className="size-3.5" aria-hidden="true" />
              {t(`config.fonts.status.${item.status}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface FontSettingsProps {
  /** 测试注入；默认用 canvas 实测 */
  measure?: MeasureFn
}

export function FontSettings({ measure }: FontSettingsProps) {
  const { t } = useTranslation()
  const readingFont = useReadingFocusStore((s) => s.readingFont)
  const setReadingFont = useReadingFocusStore((s) => s.setReadingFont)
  const [round, setRound] = useState(0)

  // round 变化 = 用户点了「重新检测」（刚装完字体后需要）
  const reports = useMemo(() => {
    void round
    const m = measure ?? canvasMeasure()
    return ROLES.map((r) => ({ ...r, report: checkStack(readStack(r.cssVar), m) }))
  }, [measure, round])

  const readingOptions: { value: ReadingFont; label: string }[] = [
    { value: 'sans', label: t('config.fonts.readingSans') },
    { value: 'serif', label: t('config.fonts.readingSerif') },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('config.fonts.intro')}</p>

      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('config.fonts.readingFont')}>
        <span className="text-sm font-medium">{t('config.fonts.readingFont')}</span>
        {readingOptions.map((o) => (
          <Button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={readingFont === o.value}
            variant={readingFont === o.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setReadingFont(o.value)}
          >
            {o.label}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-1" onClick={() => setRound((n) => n + 1)}>
          <RefreshCw className="size-3.5" />
          {t('config.fonts.recheck')}
        </Button>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('config.fonts.readingHint')}</p>

      {reports.map((r) => (
        <section key={r.id} data-role={r.id} className="space-y-1.5">
          <SectionHeading role="section" title={t(r.labelKey)} />
          <StackList report={r.report} />
          {r.report.noneInstalled && <p className="text-xs text-warning">{t('config.fonts.fallbackOnly')}</p>}
        </section>
      ))}

      <p className="text-xs text-muted-foreground">{t('config.fonts.install')}</p>
    </div>
  )
}
