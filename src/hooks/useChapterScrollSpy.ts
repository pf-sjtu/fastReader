import { useCallback, useEffect, useRef } from 'react'

interface UseChapterScrollSpyOptions {
  /** 章节 id 列表（DOM 顺序） */
  chapterIds: string[]
  /** 是否启用（如结果页 + summary 模式） */
  enabled: boolean
  /** 章节 DOM id 前缀，最终 id = `${idPrefix}${chapterId}` */
  idPrefix?: string
  /** 滚动容器选择器 */
  containerSelector?: string
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
  anchorOffset = 96
): string {
  if (chapters.length === 0) return ''

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
  onChapterChange,
  lockMs = 900,
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

    const container = document.querySelector(containerSelector) as HTMLElement | null
    if (!container) return

    let raf = 0

    const resolveActive = () => {
      if (Date.now() < lockUntilRef.current) return

      const containerTop = container.getBoundingClientRect().top
      const rects: ChapterRect[] = []

      for (const id of chapterIds) {
        const el = document.getElementById(`${idPrefix}${id}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        rects.push({ id, top: rect.top, bottom: rect.bottom })
      }

      const activeId = resolveActiveChapterId(rects, containerTop)

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
  }, [enabled, chapterIdsKey, idPrefix, containerSelector, lockMs])

  return { lock }
}
