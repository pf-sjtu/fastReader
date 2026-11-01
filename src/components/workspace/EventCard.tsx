/**
 * 时间线事件卡片。事件挂章节：所在章严格早于当前章才默认可见，
 * 否则只给"已折叠"提示，点开才渲染（折叠时文字不进 DOM）。
 */
import { ChapterPeek } from '@/components/study/ChapterPeek'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { isVisibleRank } from '@/charts/linking/entityCard'
import type { EntityLinking } from '@/charts/linking/entityLinking'
import { EntitySwatch } from './EntitySwatch'
import { rectOf } from './anchor'
import type { AnchorRect } from './anchor'

interface EventCardProps {
  linking: EntityLinking
  eventId: string
  currentChapterId?: string
  onOpenEntity: (id: string, anchor: AnchorRect) => void
  onJumpChapter: (chapterId: string) => void
  onClose?: () => void
}

export function EventCard({ linking, eventId, currentChapterId, onOpenEntity, onJumpChapter, onClose }: EventCardProps) {
  const { t } = useTranslation()
  const [reveal, setReveal] = useState(false)
  const [lastId, setLastId] = useState(eventId)
  if (lastId !== eventId) {
    setLastId(eventId)
    setReveal(false)
  }

  const ev = linking.events.get(eventId)
  if (!ev) return null

  const chapterId = linking.eventChapters.get(eventId) ?? null
  const rank = chapterId ? (linking.chapterRank.get(chapterId) ?? null) : null
  const curRank = currentChapterId ? (linking.chapterRank.get(currentChapterId) ?? 0) : 0
  const safe = isVisibleRank(rank, curRank)
  const show = safe || reveal

  return (
    <div className="space-y-3">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {show ? (
            <>
              <p className="text-xs text-muted-foreground">{ev.timeLabel}</p>
              <h3 className="t-title break-words">{ev.label}</h3>
            </>
          ) : (
            <h3 className="t-title">{t('eventCard.folded')}</h3>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-xs" className="-mr-1 -mt-1 shrink-0" onClick={onClose} aria-label={t('common.close')}>
            <X className="size-4" />
          </Button>
        )}
      </header>

      {!safe && (
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-expanded={reveal}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed p-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span>{chapterId ? t('eventCard.foldedHint') : t('eventCard.unknownHint')}</span>
          <span className="inline-flex items-center gap-0.5">
            {reveal ? t('entityCard.collapse') : t('entityCard.expand')}
            {reveal ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </button>
      )}

      {show && (
        <>
          {ev.description && <p className="text-sm leading-relaxed">{ev.description}</p>}
          {ev.entityIds.length > 0 && (
            <section aria-label={t('eventCard.entities')} className="flex flex-wrap items-center gap-1">
              {ev.entityIds.map((id) => {
                const s = linking.styles.get(id)
                if (!s) return null
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={(e) => onOpenEntity(id, rectOf(e.currentTarget))}
                    className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <EntitySwatch cssVar={s.cssVar} shape={s.shape} />
                    {s.name}
                  </button>
                )
              })}
            </section>
          )}
          {!safe && <Badge variant="outline" className="text-xs">{chapterId ? (linking.chapterTitles.get(chapterId) ?? chapterId) : t('entityCard.unknownChapter')}</Badge>}
        </>
      )}

      <footer className="border-t pt-2">
        {/* 映射不上章节就置灰并说明原因，不去猜一个位置 */}
        {(() => {
          const jump = (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={!chapterId || !show}
              title={!chapterId ? t('eventCard.noChapter') : undefined}
              onClick={() => chapterId && onJumpChapter(chapterId)}
            >
              <BookOpen className="size-3.5" />
              {chapterId ? t('eventCard.jumpChapter') : t('eventCard.noChapter')}
            </Button>
          )
          // 悬停「跳到该章」时先看一眼这章讲什么（速读）；映射不上章节则原样
          return chapterId && show ? <ChapterPeek chapterId={chapterId}>{jump}</ChapterPeek> : jump
        })()}
      </footer>
    </div>
  )
}
