import { useTranslation } from 'react-i18next'
import { Check, FileText, Layers, Network, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ProcessingMode = 'summary' | 'mindmap' | 'combined-mindmap'

const MODES: { value: ProcessingMode; icon: LucideIcon; title: string; desc: string }[] = [
  { value: 'summary', icon: FileText, title: 'config.summaryMode', desc: 'config.summaryModeDesc' },
  { value: 'mindmap', icon: Network, title: 'config.mindmapMode', desc: 'config.mindmapModeDesc' },
  { value: 'combined-mindmap', icon: Layers, title: 'config.combinedMindmapMode', desc: 'config.combinedMindmapModeDesc' },
]

interface Props {
  value: ProcessingMode
  onChange: (mode: ProcessingMode) => void
  disabled?: boolean
}

/**
 * 处理模式：三张选择卡代替下拉框——模式是用户最先做的决定，值得一眼看全、一句话看懂差别，而不是藏在下拉里。
 * 选中态：朱砂描边 + 淡底 + 右上角一枚「印」；单选语义（radiogroup），←/→（↑/↓）在三张之间移动并选中。
 */
export function ProcessingModePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const move = (from: number, step: number) => {
    const next = MODES[(from + step + MODES.length) % MODES.length]
    onChange(next.value)
    // 选中后把焦点跟过去（roving tabindex：只有选中的那张在 Tab 序里）
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-mode="${next.value}"]`)?.focus())
  }
  return (
    <div role="radiogroup" aria-label={t('config.processingMode')} className="grid gap-2 sm:grid-cols-3">
      {MODES.map(({ value: mode, icon: Icon, title, desc }, i) => {
        const checked = mode === value
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={checked}
            data-mode={mode}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(mode)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i, -1)
              }
            }}
            className={cn(
              'relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 sm:flex-col sm:gap-2',
              checked ? 'border-primary bg-primary/5 shadow-sm' : 'bg-card hover:bg-accent/60'
            )}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-md transition-colors',
                checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="min-w-0 space-y-0.5 pr-5 sm:pr-0">
              <span className="t-section block">{t(title)}</span>
              <span className="t-caption block">{t(desc)}</span>
            </span>
            {checked && (
              <span aria-hidden className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
