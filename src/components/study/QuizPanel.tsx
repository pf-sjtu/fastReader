import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useConfigStore } from '@/stores/configStore'
import { usableSummaryChapters } from '@/utils/chapterResults'
import { estimateRun } from '@/services/runEstimate'
import { useStudyStore } from '@/study/studyStore'
import type { QuizQuestion } from '@/study/schema'
import type { AnsweredQuestion } from '@/study/persistence'
import type { BookSummary } from '@/types/book'
import { RunEstimateLine } from './RunEstimateLine'

const COUNTS = [5, 10, 15] as const

interface Props {
  bookSummary: BookSummary
  /** 当前阅读章：「本章」自测的范围 */
  currentChapterId?: string
  onJumpChapter: (chapterId: string) => void
}

interface QuestionProps {
  q: QuizQuestion
  index: number
  answered: AnsweredQuestion | undefined
  onAnswer: (picked: number | null, correct: boolean) => void
  onJumpChapter: (chapterId: string) => void
}

function QuestionCard({ q, index, answered, onAnswer, onJumpChapter }: QuestionProps) {
  const { t } = useTranslation()
  // 简答题：先自己想，再点开参考答案，最后自评
  const [revealed, setRevealed] = useState(false)
  return (
    <li
      className={cn('space-y-2 rounded-lg border bg-card p-3', answered && (answered.correct ? 'border-success/50' : 'border-destructive/50'))}
      data-answered={answered ? (answered.correct ? 'correct' : 'wrong') : undefined}
    >
      <p className="text-sm font-medium leading-snug">
        <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
        {q.question}
      </p>

      {q.type === 'choice' ? (
        <div className="grid gap-1.5" role="group" aria-label={q.question}>
          {q.options?.map((opt, i) => {
            const isRight = i === q.answerIndex
            const isPicked = answered?.picked === i
            return (
              <button
                key={i}
                type="button"
                disabled={!!answered}
                aria-pressed={isPicked}
                onClick={() => onAnswer(i, isRight)}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  !answered && 'hover:bg-accent',
                  answered && isRight && 'border-success/40 bg-success/10',
                  answered && isPicked && !isRight && 'border-destructive bg-destructive/10'
                )}
              >
                <span className="w-4 shrink-0 text-xs text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0 flex-1">{opt}</span>
                {answered && isRight && <Check className="size-4 shrink-0 text-success" />}
                {answered && isPicked && !isRight && <X className="size-4 shrink-0 text-destructive" />}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {!revealed && !answered && (
            <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
              {t('study.quiz.showAnswer')}
            </Button>
          )}
          {(revealed || answered) && (
            <p className="rounded-md bg-muted p-2 text-sm leading-relaxed">
              <span className="mr-1 text-xs font-medium text-muted-foreground">{t('study.quiz.reference')}</span>
              {q.answer}
            </p>
          )}
          {revealed && !answered && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onAnswer(null, true)}>
                <Check className="size-3.5" />
                {t('study.quiz.gotIt')}
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onAnswer(null, false)}>
                <X className="size-3.5" />
                {t('study.quiz.missed')}
              </Button>
            </div>
          )}
        </div>
      )}

      {answered && (q.explanation || q.chapterId) && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {q.explanation && <p className="leading-relaxed">{q.explanation}</p>}
          {q.chapterId && (
            <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onJumpChapter(q.chapterId!)}>
              {t('study.quiz.source', { chapter: q.chapterTitle })}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** 自测：按全书或本章出题；答案附出处可跳转；答错的可单独复习（错题本） */
export function QuizPanel({ bookSummary, currentChapterId, onJumpChapter }: Props) {
  const { t } = useTranslation()
  const { data, running, errors, generateQuiz, recordAnswer, resetAnswers, cancel } = useStudyStore()
  const model = useConfigStore((s) => s.aiConfig.model)
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10)
  const [scope, setScope] = useState<'all' | 'chapter'>('all')
  const [wrongOnly, setWrongOnly] = useState(false)

  const usable = useMemo(() => usableSummaryChapters(bookSummary.chapters), [bookSummary.chapters])
  const scoped = scope === 'chapter' && currentChapterId ? usable.filter((c) => c.id === currentChapterId) : usable
  const estimate = useMemo(() => estimateRun(scoped.map((c) => c.summary ?? ''), model), [scoped, model])

  const quiz = data.quiz
  const answers = data.answers
  const answeredCount = Object.keys(answers).length
  const correctCount = Object.values(answers).filter((a) => a.correct).length
  const questions = useMemo(
    () => (quiz?.questions ?? []).map((q, i) => ({ q, i })).filter(({ q }) => !wrongOnly || answers[q.id]?.correct === false),
    [quiz, wrongOnly, answers]
  )
  const wrongCount = answeredCount - correctCount

  const field = 'h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t('study.quiz.scope')}
          <select className={field} value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'chapter')} aria-label={t('study.quiz.scope')}>
            <option value="all">{t('study.quiz.scopeAll')}</option>
            <option value="chapter" disabled={!currentChapterId}>
              {t('study.quiz.scopeChapter')}
            </option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t('study.quiz.count')}
          <select className={field} value={count} onChange={(e) => setCount(Number(e.target.value) as (typeof COUNTS)[number])} aria-label={t('study.quiz.count')}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {running.quiz ? (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" />
            {t('study.quiz.generating')}
            <Button variant="ghost" size="xs" onClick={cancel}>
              {t('study.cancel')}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant={quiz ? 'outline' : 'default'}
            className="ml-auto h-8 gap-1.5"
            disabled={!scoped.length}
            onClick={() => void generateQuiz(bookSummary, count, scope === 'chapter' ? currentChapterId : null)}
          >
            <Sparkles className="size-3.5" />
            {quiz ? t('study.quiz.regenerate') : t('study.quiz.generate')}
          </Button>
        )}
      </div>

      {!running.quiz && <RunEstimateLine tokens={estimate.inputTokens + Math.round(estimate.outputTokens * 0.6)} costRMB={estimate.costRMB} />}
      {errors.quiz && (
        <p role="alert" className="text-xs text-destructive">
          {errors.quiz === 'noChapters' ? t('study.noChapters') : t('study.failed', { error: errors.quiz })}
        </p>
      )}

      {quiz && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span role="status" className="font-medium">
            {t('study.quiz.score', { correct: correctCount, answered: answeredCount, total: quiz.questions.length })}
          </span>
          {wrongCount > 0 && (
            <button type="button" aria-pressed={wrongOnly} onClick={() => setWrongOnly((v) => !v)} className={cn('min-h-7 rounded-full border px-2.5', wrongOnly && 'bg-primary text-primary-foreground')}>
              {t('study.quiz.wrongOnly', { count: wrongCount })}
            </button>
          )}
          {answeredCount > 0 && (
            <Button variant="ghost" size="xs" className="ml-auto" onClick={() => {
                setWrongOnly(false)
                resetAnswers()
              }}>
              <RotateCcw className="size-3.5" />
              {t('study.quiz.redo')}
            </Button>
          )}
        </div>
      )}

      {!quiz && !running.quiz && <p className="py-6 text-center text-sm text-muted-foreground">{t('study.quiz.empty')}</p>}

      <ol className="space-y-2">
        {questions.map(({ q, i }) => (
          <QuestionCard key={q.id} q={q} index={i} answered={answers[q.id]} onAnswer={(picked, correct) => recordAnswer(q.id, picked, correct)} onJumpChapter={onJumpChapter} />
        ))}
      </ol>
    </div>
  )
}
