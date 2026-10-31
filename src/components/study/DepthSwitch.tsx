import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { READING_DEPTHS, kitCoverage, type ReadingDepth } from '@/study/depth'
import { useStudyStore } from '@/study/studyStore'

function label(t: (k: string) => string, d: ReadingDepth): string {
  if (d === 'full') return t('study.depth.full')
  if (d === 'points') return t('study.depth.points')
  return t('study.depth.oneliner')
}

/**
 * 三档阅读深度：全文 / 要点 / 一句话。没有速读包时前两档置灰（并提示去生成），
 * 只覆盖部分章节时提示"未覆盖的章节保持全文"。
 */
export function DepthSwitch({ chapters, className }: { chapters: readonly { id: string }[]; className?: string }) {
  const { t } = useTranslation()
  const kit = useStudyStore((s) => s.data.kit)
  const depth = useStudyStore((s) => s.depth)
  const setDepth = useStudyStore((s) => s.setDepth)
  const { covered, total } = kitCoverage(chapters, kit)
  const partial = !!kit && covered < total

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label={t('study.depth.label')} className="inline-flex rounded-full border p-0.5 text-xs">
        {READING_DEPTHS.map((d) => {
          const disabled = d !== 'full' && !kit
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              aria-pressed={depth === d}
              title={disabled ? t('study.depth.needKit') : undefined}
              onClick={() => setDepth(d)}
              className={cn(
                'min-h-7 rounded-full px-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
                depth === d ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
            >
              {label(t, d)}
            </button>
          )
        })}
      </div>
      {partial && depth !== 'full' && (
        <span className="text-xs text-muted-foreground">{t('study.depth.partial', { covered, total })}</span>
      )}
    </div>
  )
}
