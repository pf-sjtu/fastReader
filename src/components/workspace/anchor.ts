/** 浮层定位的纯函数与类型（单独成文件：组件文件只导出组件，保证 Fast Refresh 可用） */

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

export const CARD_GAP = 8
export const CARD_MARGIN = 8

export const rectOf = (el: Element): AnchorRect => {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** 纯函数：给定锚点、卡片尺寸与视口，算出 fixed 定位的 left/top（便于单测） */
export function placeCard(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; placement: 'below' | 'above' } {
  const left = Math.min(
    Math.max(anchor.x + anchor.width / 2 - size.width / 2, CARD_MARGIN),
    Math.max(CARD_MARGIN, viewport.width - size.width - CARD_MARGIN)
  )
  const below = anchor.y + anchor.height + CARD_GAP
  const above = anchor.y - CARD_GAP - size.height
  const fitsBelow = below + size.height <= viewport.height - CARD_MARGIN
  if (fitsBelow) return { left, top: below, placement: 'below' }
  if (above >= CARD_MARGIN) return { left, top: above, placement: 'above' }
  // 上下都放不下（卡片很高）：贴着能看到更多的一侧，内容区自己滚动
  const roomBelow = viewport.height - below
  return roomBelow >= anchor.y
    ? { left, top: Math.min(below, viewport.height - CARD_MARGIN - 120), placement: 'below' }
    : { left, top: CARD_MARGIN, placement: 'above' }
}
