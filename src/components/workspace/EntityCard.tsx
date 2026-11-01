/**
 * 实体卡片内容：关系概括 + 重要事件 + 在正文出现。
 * 防剧透：数据来自 buildEntityCardModel（reveal=false 时被折叠的内容不在模型里），
 * 这里只负责渲染，并在用户点击"展开"后用 reveal=true 重算。
 */
import { ChapterPeek } from '@/components/study/ChapterPeek'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Network, GitCommitHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { buildEntityCardModel, type CardSection } from '@/charts/linking/entityCard'
import type { EntityLinking } from '@/charts/linking/entityLinking'
import { EntitySwatch } from './EntitySwatch'
import { rectOf, type AnchorRect } from './anchor'

/** 同一实体在一章里最多给几个"第 k 次"快捷按钮 */
const MAX_ORDINAL_CHIPS = 5
const MAX_APPEARANCE_ROWS = 6

interface EntityCardProps {
  linking: EntityLinking
  entityId: string
  /** 当前章：悬停取标注所在章，图谱/时间线/人物志取当前阅读章 */
  currentChapterId?: string
  onOpenEntity: (id: string, anchor: AnchorRect) => void
  onOpenEvent: (eventId: string, anchor: AnchorRect) => void
  onJumpOccurrence: (entityId: string, chapterId: string, ordinal: number) => void
  onJumpTimeline: (entityId: string) => void
  onJumpGraph: (entityId: string) => void
  /** 提供时显示关闭按钮（点击打开的卡片）；悬停打开的不显示 */
  onClose?: () => void
}

export function EntityCard({
  linking,
  entityId,
  currentChapterId,
  onOpenEntity,
  onOpenEvent,
  onJumpOccurrence,
  onJumpTimeline,
  onJumpGraph,
  onClose,
}: EntityCardProps) {
  const { t } = useTranslation()
  // 展开状态属于这张卡片：换实体（key 不变也会重置）或关闭后再开都回到折叠
  const [reveal, setReveal] = useState(false)
  const [lastId, setLastId] = useState(entityId)
  if (lastId !== entityId) {
    setLastId(entityId)
    setReveal(false)
  }

  const model = useMemo(
    () => buildEntityCardModel(linking, entityId, currentChapterId, reveal),
    [linking, entityId, currentChapterId, reveal]
  )
  const style = linking.styles.get(entityId)
  if (!model || !style) return null

  const chapterLabel = (id: string | null) =>
    id ? (linking.chapterTitles.get(id) ?? id) : t('entityCard.unknownChapter')
  /** 章节标签：悬停显示该章速读（对不上章节则只是个标签） */
  const chapterBadge = (id: string | null, className: string) => {
    const badge = (
      <Badge variant="outline" className={className}>
        {chapterLabel(id)}
      </Badge>
    )
    return id ? <ChapterPeek chapterId={id} title={linking.chapterTitles.get(id)}>{badge}</ChapterPeek> : badge
  }

  const renderSection = (s: CardSection, tagged: boolean) => (
    <>
      {s.description && <p className="text-sm leading-relaxed">{s.description}</p>}

      {s.relations.length > 0 && (
        <section aria-label={t('entityCard.relations')} className="space-y-1.5">
          <h4 className="t-label">{t('entityCard.relations')}</h4>
          {s.relations.map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-1 text-sm">
              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                {g.direction === 'in' && <ArrowLeft className="size-3.5" aria-hidden="true" />}
                {g.relation}
                {g.direction === 'out' && <ArrowRight className="size-3.5" aria-hidden="true" />}
              </span>
              {g.neighbors.map((n) => {
                const ns = linking.styles.get(n.id)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={(e) => onOpenEntity(n.id, rectOf(e.currentTarget))}
                    className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {ns && <EntitySwatch cssVar={ns.cssVar} shape={ns.shape} />}
                    {n.name}
                  </button>
                )
              })}
              {tagged && chapterBadge(g.firstChapterId, 'text-xs')}
            </div>
          ))}
          {s.moreRelations > 0 && (
            <p className="text-xs text-muted-foreground">{t('entityCard.moreRelations', { count: s.moreRelations })}</p>
          )}
        </section>
      )}

      {s.events.length > 0 && (
        <section aria-label={t('entityCard.events')} className="space-y-1">
          <h4 className="t-label">{t('entityCard.events')}</h4>
          <ul className="space-y-0.5">
            {s.events.map((ev) => (
              <li key={ev.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => onOpenEvent(ev.id, rectOf(e.currentTarget))}
                  className="min-h-7 min-w-0 flex-1 truncate rounded-md px-1 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-xs text-muted-foreground">{ev.timeLabel}</span> {ev.label}
                </button>
                {tagged && chapterBadge(ev.chapterId, 'shrink-0 text-xs')}
              </li>
            ))}
          </ul>
          {s.moreEvents > 0 && (
            <p className="text-xs text-muted-foreground">{t('entityCard.moreEvents', { count: s.moreEvents })}</p>
          )}
        </section>
      )}

      {s.appearances.length > 0 && (
        <section aria-label={t('entityCard.appearances')} className="space-y-1">
          <h4 className="t-label">{t('entityCard.appearances')}</h4>
          <ul className="space-y-0.5">
            {s.appearances.slice(0, MAX_APPEARANCE_ROWS * (tagged ? 3 : 1)).map((a) => (
              <li key={a.chapterId} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onJumpOccurrence(entityId, a.chapterId, 1)}
                  className="min-h-7 min-w-0 flex-1 truncate rounded-md px-1 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  title={a.title}
                >
                  {a.title}
                </button>
                {Array.from({ length: Math.min(a.count, MAX_ORDINAL_CHIPS) }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onJumpOccurrence(entityId, a.chapterId, i + 1)}
                    aria-label={t('entityCard.nthOccurrence', { n: i + 1, chapter: a.title })}
                    className="grid size-6 place-items-center rounded-md border text-xs tabular-nums hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {i + 1}
                  </button>
                ))}
                {a.count > MAX_ORDINAL_CHIPS && <span className="text-xs text-muted-foreground">+{a.count - MAX_ORDINAL_CHIPS}</span>}
              </li>
            ))}
          </ul>
          {!tagged && s.appearances.length > MAX_APPEARANCE_ROWS && (
            <p className="text-xs text-muted-foreground">
              {t('entityCard.moreChapters', { count: s.appearances.length - MAX_APPEARANCE_ROWS })}
            </p>
          )}
        </section>
      )}
    </>
  )

  return (
    <div className="space-y-3">
      <header className="flex items-start gap-2">
        <EntitySwatch cssVar={style.cssVar} shape={style.shape} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h3 className="t-title break-words">{model.name}</h3>
          {model.type && <p className="text-xs text-muted-foreground">{model.type}</p>}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-xs" className="-mr-1 -mt-1 shrink-0" onClick={onClose} aria-label={t('common.close')}>
            <X className="size-4" />
          </Button>
        )}
      </header>

      {model.firstAppearsHere && <p className="text-xs text-muted-foreground">{t('entityCard.firstHere')}</p>}

      {renderSection(model.visible, false)}

      {/* 防剧透折叠区：只给条数；点击展开前内容不在 DOM 里 */}
      {model.hidden.total > 0 && (
        <div className="rounded-md border border-dashed p-2">
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-expanded={reveal}
            className="flex w-full items-center justify-between gap-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>{t('entityCard.spoilerFold', { count: model.hidden.total })}</span>
            <span className="inline-flex items-center gap-0.5">
              {reveal ? t('entityCard.collapse') : t('entityCard.expand')}
              {reveal ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          </button>
          {reveal && model.revealed && (
            <div className="mt-2 space-y-3 border-t pt-2">
              <p className="text-xs text-warning">{t('entityCard.spoilerWarn')}</p>
              {renderSection(model.revealed, true)}
            </div>
          )}
        </div>
      )}

      <footer className="flex flex-wrap gap-1.5 border-t pt-2">
        <Button variant="outline" size="xs" onClick={() => onJumpTimeline(entityId)}>
          <GitCommitHorizontal className="size-3.5" />
          {t('entityCard.jumpTimeline')}
        </Button>
        <Button variant="outline" size="xs" onClick={() => onJumpGraph(entityId)}>
          <Network className="size-3.5" />
          {t('entityCard.jumpGraph')}
        </Button>
      </footer>
    </div>
  )
}
