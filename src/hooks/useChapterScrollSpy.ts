import { useCallback, useEffect, useRef } from 'react'

interface UseChapterScrollSpyOptions {
  /** 章节 id 列表（DOM 顺序） */
  chapterIds: string[]
  /** 是否启用（如结果页 + summary 模式） */
  enabled: boolean
  /** 章节 DOM id 前缀，最终 id = `${idPrefix}${chapterId}` */
  idPrefix?: string
  /** 滚动容器选择器（未传 container 时使用） */
  containerSelector?: string
  /**
   * 显式滚动容器（工作台正文栏）。传 null 表示元素尚未挂载，暂不绑定；
   * 不传（undefined）则回退到 containerSelector。
   */
  container?: HTMLElement | null
  /** 当前章节变化回调 */
  onChapterChange: (chapterId: string) => void
  /**
   * 程序化滚动锁定时长（ms）。
   * 点击目录后短暂忽略 spy，避免 smooth scroll 途中误切章节。
   */
  lockMs?: number
}

export interface ChapterRect {
  id: string
  top: number
  bottom: number
}

/**
 * 根据容器与章节几何信息推断当前阅读章节。
 * 取「顶部已越过视口锚点、且距锚点最近」的章节。
 */
export function resolveActiveChapterId(
  chapters: ChapterRect[],
  containerTop: number,
  anchorOffset = 96,
  /**
   * 已滚到底部时传入。书尾若是一串折叠的矮卡片，它们的顶边永远够不到锚点，
   * 按"越过锚点"规则当前章会一直卡在前面某一章；到底部时改取"顶边已进入视口的最后一章"。
   */
  bottom?: { atBottom: boolean; containerBottom: number }
): string {
  if (chapters.length === 0) return ''

  if (bottom?.atBottom) {
    let last = ''
    for (const ch of chapters) {
      if (ch.top < bottom.containerBottom - 8) last = ch.id
    }
    if (last) return last
  }

  const anchorY = containerTop + anchorOffset
  let activeId = ''
  let bestDistance = Number.POSITIVE_INFINITY

  for (const ch of chapters) {
    const distance = anchorY - ch.top
    if (distance >= -8 && distance < bestDistance) {
      bestDistance = distance
      activeId = ch.id
    }
  }

  if (!activeId) {
    for (const ch of chapters) {
      if (ch.bottom > containerTop + 40) {
        activeId = ch.id
        break
      }
    }
  }

  return activeId
}

/**
 * 根据主内容区滚动位置，推断当前阅读章节。
 */
export function useChapterScrollSpy({
  chapterIds,
  enabled,
  idPrefix = 'chapter-summary-',
  containerSelector = '.scroll-container',
  container: explicitContainer,
  onChapterChange,
  // 要覆盖 scrollToChapterWithRetry 的 200/400/600ms 三次对齐 + 平滑滚动时长，否则点目录后高亮会被反弹
  lockMs = 1300,
}: UseChapterScrollSpyOptions) {
  const onChangeRef = useRef(onChapterChange)
  onChangeRef.current = onChapterChange

  const lockUntilRef = useRef(0)
  const lastIdRef = useRef('')
  const chapterIdsKey = chapterIds.join('\0')

  const lockMsRef = useRef(lockMs)
  lockMsRef.current = lockMs

  /** 外部在点击目录后调用，锁定一段时间内不覆盖 */
  const lock = useCallback((ms?: number) => {
    lockUntilRef.current = Date.now() + (ms ?? lockMsRef.current)
  }, [])

  useEffect(() => {
    if (!enabled || chapterIds.length === 0) return

    const container =
      explicitContainer === undefined
        ? (document.querySelector(containerSelector) as HTMLElement | null)
        : explicitContainer
    if (!container) return

    let raf = 0

    const resolveActive = () => {
      if (Date.now() < lockUntilRef.current) return

      const containerRect = container.getBoundingClientRect()
      const containerTop = containerRect.top
      // 可滚动且已到底（留 4px 容差：缩放/亚像素会让 scrollTop 差一点点）
      const atBottom =
        container.scrollHeight > container.clientHeight + 1 &&
        container.scrollTop + container.clientHeight >= container.scrollHeight - 4
      const rects: ChapterRect[] = []

      for (const id of chapterIds) {
        const el = document.getElementById(`${idPrefix}${id}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        rects.push({ id, top: rect.top, bottom: rect.bottom })
      }

      const activeId = resolveActiveChapterId(rects, containerTop, 96, {
        atBottom,
        containerBottom: containerRect.bottom,
      })

      if (activeId && activeId !== lastIdRef.current) {
        lastIdRef.current = activeId
        onChangeRef.current(activeId)
      }
    }

    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(resolveActive)
    }

    resolveActive()

    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    // chapterIdsKey 代替 chapterIds 引用，避免无意义重绑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chapterIdsKey, idPrefix, containerSelector, explicitContainer, lockMs])

  return { lock }
}
