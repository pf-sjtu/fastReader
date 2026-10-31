import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/configStore'
import { usableSummaryChapters } from '@/utils/chapterResults'
import { estimateRun, formatCount } from '@/services/runEstimate'
import { useStudyStore } from '@/study/studyStore'
import type { BookSummary } from '@/types/book'
import { DepthSwitch } from './DepthSwitch'
import { RunEstimateLine } from './RunEstimateLine'

interface Props {
  bookSummary: BookSummary
  onJumpChapter: (chapterId: string) => void
}

/** 速读包：每章一句话 + 3 要点 + 术语。手动触发，生成前先告诉用户大约要花多少 */
export function StudyKitPanel({ bookSummary, onJumpChapter }: Props) {
  const { t } = useTranslation()
  const { data, running, kitProgress, errors, generateKit, cancel } = useStudyStore()
  const model = useConfigStore((s) => s.aiConfig.model)
  const usable = useMemo(() => usableSummaryChapters(bookSummary.chapters), [bookSummary.chapters])
  const estimate = useMemo(() => estimateRun(usable.map((c) => c.summary ?? ''), model), [usable, model])
  const kit = data.kit

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DepthSwitch chapters={bookSummary.chapters} />
        {running.kit ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" />
            {kitProgress && kitProgress.total > 1
              ? t('study.kit.progress', { done: kitProgress.done, total: kitProgress.total })
              : t('study.kit.generating')}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={cancel}>
              {t('study.cancel')}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant={kit ? 'outline' : 'default'} className="h-8 gap-1.5" disabled={!usable.length} onClick={() => void generateKit(bookSummary)}>
            <Sparkles className="size-3.5" />
            {kit ? t('study.kit.regenerate') : t('study.kit.generate')}
          </Button>
        )}
      </div>

      {!running.kit && <RunEstimateLine tokens={estimate.inputTokens + estimate.outputTokens} costRMB={estimate.costRMB} />}
      {errors.kit && (
        <p role="alert" className="text-xs text-destructive">
          {errors.kit === 'noChapters' ? t('study.noChapters') : t('study.failed', { error: errors.kit })}
        </p>
      )}

      {!kit && !running.kit && <p className="py-6 text-center text-sm text-muted-foreground">{t('study.kit.empty')}</p>}

      <ol className="space-y-2">
        {kit?.chapters.map((c, i) => (
          <li key={`${c.chapterId ?? 'x'}-${i}`} className="space-y-1.5 rounded-lg border bg-card p-3">
            <button
              type="button"
              disabled={!c.chapterId}
              onClick={() => c.chapterId && onJumpChapter(c.chapterId)}
              className="text-left text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
            >
              {c.chapterTitle}
            </button>
            <p className="font-brand text-sm font-semibold leading-snug">{c.oneLiner}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-sm leading-relaxed">
              {c.points.map((p, j) => (
                <li key={j}>{p}</li>
              ))}
            </ul>
            {c.terms.length > 0 && (
              <dl className="flex flex-wrap gap-1.5 pt-1">
                {c.terms.map((term) => (
                  <div key={term.term} className="rounded-md bg-muted px-2 py-1 text-xs">
                    <dt className="inline font-medium">{term.term}</dt>
                    <dd className="inline text-muted-foreground">：{term.definition}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
      {kit && <p className="text-right text-[11px] text-muted-foreground">{t('study.kit.count', { count: kit.chapters.length, tokens: formatCount(estimate.inputTokens) })}</p>}
    </div>
  )
}
