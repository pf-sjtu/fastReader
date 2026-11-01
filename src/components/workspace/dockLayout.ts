/**
 * 对照栏页签的自适应布局（纯函数，便于单测）。
 *
 * 目标：尽量少折叠。宽度不够时按下面的顺序一级一级退让，每一级都比上一级多省一点：
 *   1. 全部「图标 + 文字」
 *   2. 次要页签只留图标，主要页签仍带文字
 *   3. 主要页签也只留图标
 *   4. 页签折进「…」菜单（次要的先折、靠后的先折；当前页签永不折）——菜单项仍是「图标 + 文字」
 *   5. 「…」按钮本身先是「图标 + 文字」，空间不够再只剩图标
 */
export interface DockLayoutInput {
  /** 页签 id，按显示顺序 */
  ids: readonly string[]
  /** 主要页签（文字最后才收起、最后才折叠） */
  primary: ReadonlySet<string>
  /** 每个页签「图标 + 文字」时的自然宽度（px）；未测量到（0 / 缺失）按「放得下」处理 */
  fullWidth: Readonly<Record<string, number>>
  /** 只有图标的页签宽度 */
  iconWidth: number
  /** 「…」按钮：图标 + 文字 / 只有图标 的宽度 */
  moreFullWidth: number
  moreIconWidth: number
  /** 页签之间的间距 */
  gap: number
  /** 可用宽度；Infinity = 不限（尚未测量） */
  available: number
  /** 当前页签：永不折叠 */
  active: string
}

export type TabMode = 'full' | 'icon'

export interface DockLayout {
  /** 直接显示的页签（保持原顺序）及其形态 */
  visible: { id: string; mode: TabMode }[]
  /** 折进菜单的页签（保持原顺序） */
  overflow: string[]
  /** 「…」按钮的形态；没有折叠时为 null（不显示） */
  more: TabMode | null
}

const rowWidth = (count: number, sum: number, gap: number) => sum + gap * Math.max(0, count - 1)

export function planDockLayout(input: DockLayoutInput): DockLayout {
  const { ids, primary, fullWidth, iconWidth, moreFullWidth, moreIconWidth, gap, available, active } = input
  const w = (id: string) => fullWidth[id] || iconWidth
  const modesOf = (fn: (id: string) => TabMode) => ids.map((id) => ({ id, mode: fn(id) }))
  const widthOf = (items: { id: string; mode: TabMode }[]) =>
    rowWidth(
      items.length,
      items.reduce((n, it) => n + (it.mode === 'full' ? w(it.id) : iconWidth), 0),
      gap
    )

  // 1–3：都放得下（不折叠），从「最全」往「最省」试
  for (const fn of [
    () => 'full' as TabMode,
    (id: string) => (primary.has(id) ? 'full' : 'icon') as TabMode,
    () => 'icon' as TabMode,
  ]) {
    const items = modesOf(fn)
    if (widthOf(items) <= available) return { visible: items, overflow: [], more: null }
  }

  // 4：折叠。次要的先折，同级里靠后的先折；当前页签不折
  const foldOrder = ids
    .map((id, i) => ({ id, i }))
    .filter((x) => x.id !== active)
    .sort((a, b) => Number(primary.has(a.id)) - Number(primary.has(b.id)) || b.i - a.i)
    .map((x) => x.id)

  const plan = (folded: number, moreWidth: number) => {
    const hide = new Set(foldOrder.slice(0, folded))
    const visible = ids.filter((id) => !hide.has(id)).map((id) => ({ id, mode: 'icon' as TabMode }))
    // 「…」与页签之间也隔一个 gap
    return { visible, fits: widthOf(visible) + gap + moreWidth <= available, hide }
  }

  // 折得越少越好：先试折 1 个、再 2 个……用「只有图标」的「…」判断放不放得下，再看能不能升级成「图标 + 文字」
  for (let folded = 1; folded <= foldOrder.length; folded++) {
    const p = plan(folded, moreIconWidth)
    if (p.fits || folded === foldOrder.length) {
      const fullMore = plan(folded, moreFullWidth).fits
      return {
        visible: p.visible,
        overflow: ids.filter((id) => p.hide.has(id)),
        more: fullMore ? 'full' : 'icon',
      }
    }
  }
  // 只有一个页签（foldOrder 为空）：放不下也没得折，原样显示
  return { visible: modesOf(() => 'icon'), overflow: [], more: null }
}
