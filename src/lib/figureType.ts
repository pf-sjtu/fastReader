/**
 * 图的排版：图内文字与正文**同栈同字号**。
 *
 * 为什么需要单独一个模块：
 * 1. 图是用 `<img src="data:image/svg+xml,…">` 呈现的——**图片文档继承不到宿主 CSS**，
 *    所以 `fontFamily: 'inherit'` 等于没写；字体栈必须以字面量写进 SVG 自身。
 * 2. 图会被 CSS 缩放，缩放倍率取决于图本身的尺寸，"同一个 16px" 在不同图里会显示成 15–54px
 *    （实测 stateDiagram 的 viewBox 是 220×254，被拉满容器后放大 3.39× → 54.3px，而正文只有 15px）。
 *
 * 所以这里收口三件事：字体栈（唯一来源仍是 index.css 的 `--font-sans`，见 tests/figureType.test.ts）、
 * 字号（`--base-font-size` × `--font-scale`，跟随「字体大小」设置）、以及缩放策略（`figureFit`：
 * 不放大、缩到不低于 `MIN_FIGURE_TEXT_PX`、再宽就交给调用方的 overflow-x-auto 横滚）。
 *
 * 纯模块：不引 React，可在 node 环境下测试。
 */

/**
 * 图内文字的字体栈。**必须与 index.css 的 `--font-sans` 逐字一致**（守卫会断言）。
 * 图/离线包这类脱离宿主 CSS 的地方（SVG data URI、iframe 沙箱文档、导出的独立 HTML）
 * 只能写具体值——但"具体值"只允许出现在这一个常量里。
 */
export const FIGURE_FONT_STACK =
  '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif'

/** 缩放后图内文字的可读下限：比这更小就不再缩（改为横向滚动），别把图缩成看不清 */
export const MIN_FIGURE_TEXT_PX = 11

/** 拿不到 CSS 变量时（jsdom / 导出脚本 / serve 之前）的兜底，与 index.css 的初值一致 */
export const FALLBACK_BASE_FONT_PX = 15
export const FALLBACK_FONT_SCALE = 1

/** 用户改「字体大小」时派发的事件：图要重新渲染才能拿到新字号（图片文档不会自动跟随） */
export const FONT_SCALE_EVENT = 'juhua:font-scale'

export interface FigureType {
  fontStack: string
  /** --base-font-size（px） */
  basePx: number
  /** --font-scale */
  scale: number
  /** 图内文字应有的字号（px）= basePx × scale */
  textPx: number
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number.parseFloat((v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * 读当前生效的图排版参数。读的是**计算后**的 CSS 变量，所以用户调过字号也拿得到新值；
 * 在没有 DOM（或 jsdom 没有变量）的环境退回兜底值，图仍然能画出来。
 */
export function readFigureType(root?: Element | null): FigureType {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  const cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  const basePx = num(cs?.getPropertyValue('--base-font-size'), FALLBACK_BASE_FONT_PX)
  const scale = num(cs?.getPropertyValue('--font-scale'), FALLBACK_FONT_SCALE)
  const fontStack = (cs?.getPropertyValue('--font-sans') ?? '').trim() || FIGURE_FONT_STACK
  return { fontStack, basePx, scale, textPx: basePx * scale }
}

export interface FitInput {
  /** 图的原始宽度（SVG 的 width/viewBox 宽） */
  naturalW: number
  /** 容器可用宽度；拿不到（0/NaN）时按"不缩放"处理 */
  containerW: number
  /** 1× 时图内文字的字号（px） */
  textPx: number
  /** 可读下限，默认 MIN_FIGURE_TEXT_PX */
  minTextPx?: number
}

/**
 * 决定把图渲染成多少倍：
 * - 永不放大（窄图保持原尺寸，字号就是 textPx）；
 * - 超宽时缩小，但缩到"文字恰好 minTextPx"为止；
 * - 比这还宽就返回那个下限倍率，图会比容器宽 → 由调用方的 overflow-x-auto 提供横滚。
 * - 用户把字号调得很小时 textPx 本身就小于下限：不放大，也不额外缩小（否则会越缩越小）。
 */
export function figureFit({ naturalW, containerW, textPx, minTextPx = MIN_FIGURE_TEXT_PX }: FitInput): number {
  if (!Number.isFinite(naturalW) || naturalW <= 0) return 1
  if (!Number.isFinite(containerW) || containerW <= 0) return 1
  if (!Number.isFinite(textPx) || textPx <= 0) return 1
  const fit = containerW / naturalW
  const floor = minTextPx / textPx
  return Math.min(1, Math.max(fit, floor))
}

/** 从 mermaid 产出的 SVG 取原始尺寸（优先 width/height 属性，退回 viewBox；都取不到给 null） */
export function svgNaturalSize(svg: string): { w: number; h: number } | null {
  const w = /\swidth="([\d.]+)"/.exec(svg)?.[1]
  const h = /\sheight="([\d.]+)"/.exec(svg)?.[1]
  if (w && h) {
    const nw = Number.parseFloat(w)
    const nh = Number.parseFloat(h)
    if (nw > 0 && nh > 0) return { w: nw, h: nh }
  }
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] }
  return null
}
