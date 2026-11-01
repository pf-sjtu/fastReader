import { COMPANION_MIN_WIDTH, NAV_MIN_WIDTH } from '@/stores/readingFocus'

/** 正文列的最小宽度：再窄就读不动了（书名被截断、卡片按钮互相重叠） */
export const BODY_MIN_WIDTH = 420
/** 工作台可用宽度低于它就改用紧凑布局（目录=左抽屉、对照栏=底部抽屉），不硬挤三栏 */
export const COMPACT_BELOW = 1000
/** App 外壳左右内边距之和（px-1.5…sm:p-4，取大值）与工作台最大宽度（2xl:max-w-[110rem]） */
const PAGE_GUTTER = 48
/** 超宽屏的工作台上限（App.tsx 的 min-[1800px]:max-w-[160rem]）；1760 以内的屏幕布局不变 */
const PAGE_MAX = 2560
/** 超过它的宽度才算「超宽」，多出来的部分按比例加给目录 / 对照栏 */
const WIDE_FROM = 1760
const WIDE_SHARE_NAV = 0.1
const WIDE_SHARE_DOCK = 0.55 // 其余 35% 留给正文列，避免行宽过长

const HANDLE = 8 // ResizeHandle 的 w-2
const DOCK_PAD = 12 // 对照栏的 pl-3
const NAV_RAIL = 14 + 12 // 折叠后的进度条 + mr-3
const DOCK_REOPEN = 56 // 对照栏收起后的「展开」按钮列

/** 视口宽度 → 工作台容器宽度 */
export const containerWidth = (viewport: number) => Math.min(viewport - PAGE_GUTTER, PAGE_MAX)

/**
 * 超宽屏的额外宽度：只加在「显示宽度」上，用户存的偏好宽度不变。
 * 拖拽时界面要把它减回去再存（见 ReaderWorkspace），否则一拖就会跳一个 bonus。
 */
export function wideBonus(container: number): { nav: number; companion: number } {
  const extra = Math.max(0, container - WIDE_FROM)
  return { nav: Math.round(extra * WIDE_SHARE_NAV), companion: Math.round(extra * WIDE_SHARE_DOCK) }
}

export const isCompactWidth =(viewport: number) => containerWidth(viewport) < COMPACT_BELOW

interface FitInput {
  container: number
  navWidth: number
  navCollapsed: boolean
  companionWidth: number
  companionOpen: boolean
}

/**
 * 三栏布局的宽度夹紧：保证正文列 ≥ BODY_MIN_WIDTH。
 * 空间不够时先压对照栏（不低于它的最小宽度），再压目录（不低于它的最小宽度）。
 * 只影响显示：用户存的偏好宽度不改，窗口变宽后自动恢复。
 */
export function fitColumns({ container, navWidth, navCollapsed, companionWidth, companionOpen }: FitInput): { nav: number; companion: number } {
  const navCost = (w: number) => (navCollapsed ? NAV_RAIL : w + HANDLE)
  const dockCost = (w: number) => (companionOpen ? w + DOCK_PAD + HANDLE : DOCK_REOPEN)
  let nav = navWidth
  let companion = companionWidth
  let over = navCost(nav) + dockCost(companion) + BODY_MIN_WIDTH - container

  if (over > 0 && companionOpen) {
    const cut = Math.min(over, companion - COMPANION_MIN_WIDTH)
    companion -= Math.max(0, cut)
    over -= Math.max(0, cut)
  }
  if (over > 0 && !navCollapsed) {
    const cut = Math.min(over, nav - NAV_MIN_WIDTH)
    nav -= Math.max(0, cut)
  }
  return { nav, companion }
}
