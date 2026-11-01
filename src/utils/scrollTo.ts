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

/** 对齐位置（上沿留白 offset）之下已经读进这一章多少像素；找不到章节 / 还没滚到它 → 0 */
export function chapterReadOffset(chapterId: string, { container, offset = 80, idPrefix = CHAPTER_SUMMARY_ID_PREFIX }: ScrollToChapterOptions = {}): number {
  const element = document.getElementById(`${idPrefix}${chapterId}`)
  const box = resolveScrollContainer(container)
  if (!element || !box) return 0
  const px = box.getBoundingClientRect().top + offset - element.getBoundingClientRect().top
  return Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0
}

/** 在章节对齐位置的基础上再往下读 px 像素（不超过这一章的高度）；章节不存在返回 false */
export function scrollInsideChapter(chapterId: string, px: number, { container, offset = 80, idPrefix = CHAPTER_SUMMARY_ID_PREFIX }: ScrollToChapterOptions = {}): boolean {
  const element = document.getElementById(`${idPrefix}${chapterId}`)
  const box = resolveScrollContainer(container)
  if (!element || !box || !(px > 0)) return false
  const inside = Math.min(px, Math.max(0, element.offsetHeight - offset))
  const top = box.scrollTop + (element.getBoundingClientRect().top - box.getBoundingClientRect().top) - offset + inside
  box.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  return true
}

export function scrollContainerToTop(container?: HTMLElement | null) {
  resolveScrollContainer(container)?.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 把任意元素滚到容器上沿下方 offset 处（实体标注这类没有固定 id 的目标） */
export function scrollContainerToElement(
  el: HTMLElement,
  { container, offset = 120, behavior = 'smooth' }: { container?: HTMLElement | null; offset?: number; behavior?: ScrollBehavior } = {}
): void {
  const box = resolveScrollContainer(container)
  if (!box) {
    el.scrollIntoView({ behavior, block: 'center' })
    return
  }
  const top = box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - offset
  box.scrollTo({ top: Math.max(0, top), behavior })
}

/** 到达高亮：给元素加 .link-flash（≤2s，reduced-motion 下是静态描边），到点自动移除。返回取消函数 */
export function flashElement(el: Element, ms = 1700): () => void {
  el.classList.remove('link-flash')
  // 强制回流：连续两次对同一元素闪烁时，动画才会重新开始
  void (el as HTMLElement).offsetWidth
  el.classList.add('link-flash')
  const timer = setTimeout(() => el.classList.remove('link-flash'), ms)
  return () => {
    clearTimeout(timer)
    el.classList.remove('link-flash')
  }
}

/**
 * 等某个元素出现（折叠的章节卡展开后才渲染正文）。用 setTimeout 轮询而不是 rAF：
 * 后台标签页里 rAF 会被暂停，轮询仍然工作。
 */
export function waitForElement(
  find: () => HTMLElement | null,
  { timeoutMs = 1200, intervalMs = 40 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      const el = find()
      if (el) return resolve(el)
      if (Date.now() - start >= timeoutMs) return resolve(null)
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}
