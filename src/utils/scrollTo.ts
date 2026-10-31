/**
 * 滚动容器工具。
 * 旧布局的滚动容器是全局 `.scroll-container`；阅读工作台里正文栏自己滚动。
 * 工作台挂载时登记容器，命令式跳转（目录点击、回到顶部）优先用登记的容器，
 * 未登记时回退到选择器，保持旧布局行为不变。
 */

export const DEFAULT_SCROLL_SELECTOR = '.scroll-container'
export const CHAPTER_SUMMARY_ID_PREFIX = 'chapter-summary-'

let registered: HTMLElement | null = null

/** 登记当前活动的滚动容器；卸载时传 null（只清除自己登记的那个，避免误清后挂载者） */
export function registerScrollContainer(el: HTMLElement | null, owner?: HTMLElement | null) {
  if (el === null && owner && registered !== owner) return
  registered = el
}

export function resolveScrollContainer(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit) return explicit
  if (registered && registered.isConnected) return registered
  if (typeof document === 'undefined') return null
  return document.querySelector(DEFAULT_SCROLL_SELECTOR) as HTMLElement | null
}

export interface ScrollToChapterOptions {
  container?: HTMLElement | null
  /** 目标上沿与容器上沿的留白 */
  offset?: number
  idPrefix?: string
  behavior?: ScrollBehavior
}

/** 滚动一次：把章节卡上沿对齐到容器上沿（留 offset） */
export function scrollContainerToChapter(
  chapterId: string,
  { container, offset = 80, idPrefix = CHAPTER_SUMMARY_ID_PREFIX, behavior = 'smooth' }: ScrollToChapterOptions = {}
): boolean {
  const element = document.getElementById(`${idPrefix}${chapterId}`)
  if (!element) return false
  const box = resolveScrollContainer(container)
  if (box) {
    const top = box.scrollTop + (element.getBoundingClientRect().top - box.getBoundingClientRect().top) - offset
    box.scrollTo({ top: Math.max(0, top), behavior })
  } else {
    element.scrollIntoView({ behavior, block: 'start' })
  }
  return true
}

/**
 * 折叠动画/懒渲染未完成时目标位置会漂移：在 200/400/600ms 各对齐一次。
 * 返回取消函数，组件卸载或再次跳转时调用。
 */
export function scrollToChapterWithRetry(chapterId: string, opts: ScrollToChapterOptions = {}): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    timers.push(setTimeout(() => scrollContainerToChapter(chapterId, opts), attempt * 200))
  }
  return () => timers.forEach(clearTimeout)
}

export function scrollContainerToTop(container?: HTMLElement | null) {
  resolveScrollContainer(container)?.scrollTo({ top: 0, behavior: 'smooth' })
}
