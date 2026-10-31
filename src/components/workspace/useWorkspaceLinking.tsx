/**
 * 工作台的"联动"装配：把 linking 查询表、正文标注、章节条、图表入参、悬浮卡片收口在一处，
 * 让 ReaderWorkspace 只关心布局。
 *
 * 性能约束：chapterExtras / 插件数组必须稳定，且**不依赖当前阅读章**——
 * 否则正文每滚过一章，所有章节卡都会重新处理 Markdown。当前章只流向图表入参与卡片。
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { RemarkPlugins } from '@/components/MarkdownCard'
import { remarkEntityMark } from '@/charts/linking/remarkEntityMark'
import {
  chapterEntityIds,
  chapterEventIds,
  earliestRank,
  entityChapterList,
  nextOccurrence,
} from '@/charts/linking/entityLinking'
import { useEntityLinking } from '@/charts/linking/useEntityLinking'
import type { BookSummary } from '@/hooks/useBookProcessing'
import type { ChartPluginProps } from '@/charts/types'
import { useReadingFocusStore } from '@/stores/readingFocus'
import { EntityCard } from './EntityCard'
import { EntityStrip } from './EntityStrip'
import { EventCard } from './EventCard'
import { FloatingCard } from './FloatingCard'
import { useArtifactNavigation } from './useArtifactNavigation'

interface Params {
  bookSummary: BookSummary
  processing: boolean
  bodyEl: HTMLElement | null
  currentChapterId: string
  navigateChapter: (chapterId: string) => void
  expandChapter: (chapterId: string) => void
}

export function useWorkspaceLinking({
  bookSummary,
  processing,
  bodyEl,
  currentChapterId,
  navigateChapter,
  expandChapter,
}: Params) {
  const { t } = useTranslation()
  const linking = useEntityLinking(bookSummary.charts, bookSummary.chapters, processing)
  const { annotate, progressive, colorize, focusedEntityId, focusedEventId, jumpNonce } = useReadingFocusStore(
    useShallow((s) => ({
      annotate: s.annotateEntities,
      progressive: s.progressiveGraph,
      colorize: s.colorizeGraph,
      focusedEntityId: s.focusedEntityId,
      focusedEventId: s.focusedEventId,
      jumpNonce: s.jumpNonce,
    }))
  )
  const nav = useArtifactNavigation({ linking, bodyEl, currentChapterId, navigateChapter, expandChapter })
  const { openEntityCard, openEventCard, closeCard, jumpToOccurrence } = nav

  /* ---------- 正文：实体标注 + 本章出场条（稳定引用，不依赖当前章） ---------- */

  const remarkPlugins = useMemo<RemarkPlugins | undefined>(() => {
    if (!linking || !annotate) return undefined
    const slotOf = (id: string) => {
      const s = linking.styles.get(id)
      return s ? (s.slot ? String(s.slot) : 'n') : undefined
    }
    return [[remarkEntityMark, { matcher: linking.matcher, slotOf }]] as RemarkPlugins
  }, [linking, annotate])

  const chapterExtras = useMemo(() => {
    if (!linking) return undefined
    return {
      remarkPlugins,
      renderStrip: (chapterId: string): ReactNode => (
        <EntityStrip
          linking={linking}
          chapterId={chapterId}
          onOpenEntity={(id, anchor, ch) => openEntityCard(id, anchor, { chapterId: ch })}
        />
      ),
    }
  }, [linking, remarkPlugins, openEntityCard])

  /* ---------- 图表：焦点 + 回调（可依赖当前章） ---------- */

  const pluginProps = useMemo<Omit<ChartPluginProps, 'charts'> | undefined>(() => {
    if (!linking) return undefined
    const curRank = linking.chapterRank.get(currentChapterId)

    // 渐进模式口径是"截至本章（含本章）"：本章正文就在屏幕上；与卡片折叠（不含本章）不同，界面上有说明
    let visibleEntityIds: Set<string> | undefined
    let visibleEdgeKeys: Set<string> | undefined
    if (progressive && curRank !== undefined) {
      visibleEntityIds = new Set()
      for (const id of linking.styles.keys()) {
        const r = earliestRank(linking, linking.entityChapters.get(id) ?? [])
        if (r !== null && r <= curRank) visibleEntityIds.add(id)
      }
      visibleEdgeKeys = new Set()
      for (const e of linking.edges) {
        const r = earliestRank(linking, e.chapters)
        if (r !== null && r <= curRank) visibleEdgeKeys.add(e.key)
      }
    }

    return {
      focus: {
        chapterId: currentChapterId,
        chapterEntityIds: chapterEntityIds(linking, currentChapterId),
        chapterEventIds: chapterEventIds(linking, currentChapterId),
        focusedEntityId,
        focusedEventId,
        visibleEntityIds,
        visibleEdgeKeys,
        jumpNonce,
      },
      colorize,
      styleOf: (id) => {
        const s = linking.styles.get(id)
        return s ? { slot: s.slot, cssVar: s.cssVar, shape: s.shape } : undefined
      },
      // 单击只展开卡片并选中，不跳转（防误触）；跳转在卡片的明确按钮里
      onEntitySelect: (id, anchor) => (id && anchor ? openEntityCard(id, anchor, { hover: false }) : closeCard()),
      onEntityDoubleClick: (id) => {
        const next = nextOccurrence(linking, id, currentChapterId, linking.chapterOrder)
        if (next) void jumpToOccurrence(id, next.chapterId, next.ordinal)
      },
      onEventSelect: (id, anchor) => anchor && openEventCard(id, anchor),
      onChapterJump: nav.jumpToChapter,
      resolveEventChapter: (id) => linking.eventChapters.get(id) ?? null,
      resolveEntityChapters: (id) => entityChapterList(linking, id),
    }
  }, [
    linking,
    currentChapterId,
    progressive,
    colorize,
    focusedEntityId,
    focusedEventId,
    jumpNonce,
    openEntityCard,
    openEventCard,
    closeCard,
    jumpToOccurrence,
    nav.jumpToChapter,
  ])

  /* ---------- 悬浮卡片 ---------- */

  const openFromCard = useCallback(
    (id: string, anchor: Parameters<typeof openEntityCard>[1]) =>
      openEntityCard(id, anchor, { chapterId: nav.card?.chapterId, hover: false }),
    [openEntityCard, nav.card?.chapterId]
  )

  const card = nav.card
  const floating =
    card && linking ? (
      <FloatingCard
        key={`${card.kind}:${card.id}`}
        anchor={card.anchor}
        label={t(card.kind === 'entity' ? 'entityCard.aria' : 'eventCard.aria')}
        takeFocus={!card.hover}
        onClose={closeCard}
        {...nav.cardHandlers}
      >
        {card.kind === 'entity' ? (
          <EntityCard
            linking={linking}
            entityId={card.id}
            currentChapterId={card.chapterId ?? currentChapterId}
            onOpenEntity={openFromCard}
            onOpenEvent={(id, anchor) => openEventCard(id, anchor, { chapterId: card.chapterId })}
            onJumpOccurrence={(e, c, n) => void jumpToOccurrence(e, c, n)}
            onJumpTimeline={nav.jumpToTimeline}
            onJumpGraph={nav.jumpToGraph}
            onClose={card.hover ? undefined : closeCard}
          />
        ) : (
          <EventCard
            linking={linking}
            eventId={card.id}
            currentChapterId={card.chapterId ?? currentChapterId}
            onOpenEntity={openFromCard}
            onJumpChapter={nav.jumpToChapter}
            onClose={closeCard}
          />
        )}
      </FloatingCard>
    ) : null

  return {
    linking,
    chapterExtras,
    pluginProps,
    bodyHandlers: nav.bodyHandlers,
    floating,
    canBack: nav.canBack,
    back: nav.back,
    /** 人物志等非正文入口：点击打开固定卡片，"本章"取当前阅读章 */
    openEntity: (id: string, anchor: Parameters<typeof openEntityCard>[1]) =>
      openEntityCard(id, anchor, { hover: false }),
  }
}
