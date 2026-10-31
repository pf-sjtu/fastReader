/**
 * 产物之间的关联与跳转控制器（spec: artifact-linking）。
 *
 * 防误触模型：单击/悬停只"打开卡片并选中"，从不改变任何区域的滚动位置；
 * 跳转只由卡片里的明确按钮（或可选的双击快捷）触发。
 * 每次跳转前记录正文滚动位置，可"返回上一位置"。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { nextOccurrence, type EntityLinking } from '@/charts/linking/entityLinking'
import { useReadingFocusStore } from '@/stores/readingFocus'
import {
  flashElement,
  scrollContainerToChapter,
  scrollContainerToElement,
  waitForElement,
} from '@/utils/scrollTo'
import type { AnchorRect } from './anchor'
import { rectOf } from './anchor'

export interface CardTarget {
  kind: 'entity' | 'event'
  id: string
  anchor: AnchorRect
  /** 悬停取标注所在章；其余入口为空（用当前阅读章） */
  chapterId?: string
  /** 悬停打开的（鼠标移出就关）；false = 点击打开的（固定，Esc/点空白才关） */
  hover: boolean
}

/** 悬停多久才出卡片 / 移出后多久关闭 */
export const HOVER_OPEN_MS = 300
export const HOVER_CLOSE_MS = 200
const HISTORY_MAX = 20
const MARK_SELECTOR = '.entity-mark'
const CHAPTER_ID_PREFIX = 'chapter-summary-'

interface Params {
  linking: EntityLinking | null
  bodyEl: HTMLElement | null
  currentChapterId: string
  /** 目录点击同款：锁 spy + 展开并滚到该章 */
  navigateChapter: (chapterId: string) => void
  /** 只展开不收起其它章（跳到某个标注前要先让该章渲染出来） */
  expandChapter: (chapterId: string) => void
}

/** 标注所在的章节 id（取最近的 #chapter-summary-*） */
export function chapterOfMark(el: Element): string | undefined {
  const card = el.closest(`[id^="${CHAPTER_ID_PREFIX}"]`)
  return card ? card.id.slice(CHAPTER_ID_PREFIX.length) : undefined
}

/** 触屏（无悬停能力）设备上，点击会合成 mouseover：此时只响应点击，不开悬停卡片 */
export function canHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return !window.matchMedia('(hover: none)').matches
}

/** 用户正在框选文字（拖选落在同一个标注内也会触发 click）：这种点击不当作"打开卡片" */
export function isSelectingText(): boolean {
  return (window.getSelection?.()?.toString() ?? '').trim().length > 0
}

/** 取章内第 k 个该实体的标注；索引与 DOM 偶有错位（跨加粗边界等），超出就退到最后一个 */
export function pickMark(marks: ArrayLike<HTMLElement>, ordinal: number): HTMLElement | null {
  if (!marks.length) return null
  return marks[Math.min(Math.max(ordinal, 1), marks.length) - 1]
}

export function useArtifactNavigation({ linking, bodyEl, currentChapterId, navigateChapter, expandChapter }: Params) {
  const [card, setCard] = useState<CardTarget | null>(null)
  const [historyLen, setHistoryLen] = useState(0)
  const history = useRef<{ scrollTop: number }[]>([])
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelFlash = useRef<(() => void) | null>(null)
  const cardRef = useRef(card)
  cardRef.current = card
  const alive = useRef(true)

  const focusEntity = useReadingFocusStore((s) => s.focusEntity)
  const focusEvent = useReadingFocusStore((s) => s.focusEvent)

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = closeTimer.current = null
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimers()
      cancelFlash.current?.()
    }
  }, [clearTimers])

  const closeCard = useCallback(() => {
    clearTimers()
    setCard(null)
  }, [clearTimers])

  // 正文滚动后锚点位置已失效：直接关掉（不是跳转，只是别让卡片悬在错的地方）
  useEffect(() => {
    if (!bodyEl) return
    const onScroll = () => {
      if (cardRef.current) closeCard()
    }
    bodyEl.addEventListener('scroll', onScroll, { passive: true })
    return () => bodyEl.removeEventListener('scroll', onScroll)
  }, [bodyEl, closeCard])

  /* ---------------- 跳转历史 ---------------- */

  const pushHistory = useCallback(() => {
    if (!bodyEl) return
    history.current.push({ scrollTop: bodyEl.scrollTop })
    if (history.current.length > HISTORY_MAX) history.current.shift()
    setHistoryLen(history.current.length)
  }, [bodyEl])

  const back = useCallback(() => {
    const prev = history.current.pop()
    setHistoryLen(history.current.length)
    if (prev && bodyEl) bodyEl.scrollTo({ top: prev.scrollTop, behavior: 'smooth' })
  }, [bodyEl])

  const flash = useCallback((el: Element) => {
    cancelFlash.current?.()
    cancelFlash.current = flashElement(el)
  }, [])

  /* ---------------- 跳转 ---------------- */

  const jumpToChapter = useCallback(
    (chapterId: string) => {
      closeCard()
      pushHistory()
      navigateChapter(chapterId)
      // 等"展开 + 滚动"落定后再闪（目录点击的重试对齐最晚 600ms）
      void waitForElement(() => document.getElementById(`${CHAPTER_ID_PREFIX}${chapterId}`)).then((el) => {
        if (el && alive.current) setTimeout(() => alive.current && flash(el), 650)
      })
    },
    [closeCard, pushHistory, navigateChapter, flash]
  )

  const jumpToOccurrence = useCallback(
    async (entityId: string, chapterId: string, ordinal: number) => {
      closeCard()
      pushHistory()
      expandChapter(chapterId) // 折叠的章节卡不渲染正文，先展开
      const findMarks = () =>
        document.querySelectorAll<HTMLElement>(
          `#${CSS.escape(CHAPTER_ID_PREFIX + chapterId)} ${MARK_SELECTOR}[data-entity-id="${CSS.escape(entityId)}"]`
        )
      const first = await waitForElement(() => findMarks()[0] ?? null)
      if (!alive.current) return
      const mark = first ? pickMark(findMarks(), ordinal) : null
      if (mark) {
        scrollContainerToElement(mark, { container: bodyEl })
        flash(mark)
      } else {
        // 该章没有可定位的标注（标注被关闭 / 索引与 DOM 错位）：退而定位到章节卡
        scrollContainerToChapter(chapterId, { container: bodyEl })
        const el = document.getElementById(`${CHAPTER_ID_PREFIX}${chapterId}`)
        if (el) flash(el)
      }
    },
    [closeCard, pushHistory, expandChapter, bodyEl, flash]
  )

  const jumpToTimeline = useCallback(
    (entityId: string) => {
      closeCard()
      focusEntity(entityId, { tab: 'timeline' })
    },
    [closeCard, focusEntity]
  )

  const jumpToGraph = useCallback(
    (entityId: string) => {
      closeCard()
      focusEntity(entityId, { tab: 'graph' })
    },
    [closeCard, focusEntity]
  )

  const jumpToEvent = useCallback(
    (eventId: string) => {
      closeCard()
      focusEvent(eventId)
    },
    [closeCard, focusEvent]
  )

  /* ---------------- 卡片 ---------------- */

  const openEntityCard = useCallback(
    (id: string, anchor: AnchorRect, opts: { chapterId?: string; hover?: boolean } = {}) => {
      clearTimers()
      setCard({ kind: 'entity', id, anchor, chapterId: opts.chapterId, hover: !!opts.hover })
    },
    [clearTimers]
  )

  const openEventCard = useCallback(
    (id: string, anchor: AnchorRect, opts: { chapterId?: string } = {}) => {
      clearTimers()
      setCard({ kind: 'event', id, anchor, chapterId: opts.chapterId, hover: false })
    },
    [clearTimers]
  )

  /* ---------------- 正文里的实体标注：事件委托 ---------------- */

  const markOf = (e: ReactMouseEvent): HTMLElement | null =>
    (e.target as Element | null)?.closest?.(MARK_SELECTOR) as HTMLElement | null

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (cardRef.current?.hover) setCard(null)
    }, HOVER_CLOSE_MS)
  }, [])

  const bodyHandlers = useMemo(
    () => ({
      onMouseOver: (e: ReactMouseEvent) => {
        const mark = markOf(e)
        if (!mark || !mark.dataset.entityId || !canHover()) return
        // 已有"点击固定"的卡片时，悬停不去顶替它
        if (cardRef.current && !cardRef.current.hover) return
        if (closeTimer.current) clearTimeout(closeTimer.current)
        if (openTimer.current) clearTimeout(openTimer.current)
        const id = mark.dataset.entityId
        openTimer.current = setTimeout(() => {
          if (!alive.current || !mark.isConnected) return
          setCard({ kind: 'entity', id, anchor: rectOf(mark), chapterId: chapterOfMark(mark), hover: true })
        }, HOVER_OPEN_MS)
      },
      onMouseOut: (e: ReactMouseEvent) => {
        const mark = markOf(e)
        if (!mark) return
        // 在同一个标注内部移动（子节点之间）不算离开
        if (e.relatedTarget instanceof Node && mark.contains(e.relatedTarget)) return
        if (openTimer.current) clearTimeout(openTimer.current)
        openTimer.current = null
        if (cardRef.current?.hover) scheduleClose()
      },
      onClick: (e: ReactMouseEvent) => {
        const mark = markOf(e)
        if (!mark?.dataset.entityId || isSelectingText()) return
        openEntityCard(mark.dataset.entityId, rectOf(mark), { chapterId: chapterOfMark(mark), hover: false })
      },
      // 可选快捷：双击 = 定位到该实体的"下一次出现"。不替代卡片里的明确按钮
      onDoubleClick: (e: ReactMouseEvent) => {
        const mark = markOf(e)
        const id = mark?.dataset.entityId
        if (!mark || !id || !linking) return
        const from = chapterOfMark(mark) ?? currentChapterId
        const next = nextOccurrence(linking, id, from, linking.chapterOrder)
        if (next) void jumpToOccurrence(id, next.chapterId, next.ordinal)
      },
    }),
    [openEntityCard, scheduleClose, linking, currentChapterId, jumpToOccurrence]
  )

  const cardHandlers = useMemo(
    () => ({
      onPointerEnter: () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
        closeTimer.current = null
      },
      onPointerLeave: () => {
        if (cardRef.current?.hover) scheduleClose()
      },
    }),
    [scheduleClose]
  )

  return {
    card,
    closeCard,
    openEntityCard,
    openEventCard,
    bodyHandlers,
    cardHandlers,
    jumpToChapter,
    jumpToOccurrence,
    jumpToTimeline,
    jumpToGraph,
    jumpToEvent,
    back,
    canBack: historyLen > 0,
  }
}
