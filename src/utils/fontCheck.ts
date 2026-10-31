/**
 * 字体检测：本站不下载字体，只用设备上已安装的字体，按 CSS 变量里写好的优先级取第一个可用的。
 * 设置页用这里告诉用户「推荐哪些字体、顺序是什么、装没装、当前实际用的是哪个」。
 *
 * 检测原理：用 canvas 量同一段文字的宽度。`font: "候选字体", 基线字体` 若与单独用基线字体的宽度不同，
 * 说明候选字体存在（否则浏览器会回退到基线字体，宽度完全一样）。对三种基线都试一遍，避免巧合相等。
 * （`document.fonts.check` 对「未用 @font-face 声明的系统字体」永远返回 true，不能用。）
 */

/** 通用族名：永远可用，不能也不需要检测 */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
])

export const isGenericFamily = (name: string) => GENERIC.has(name.trim().toLowerCase())

/** 解析 CSS font-family 值：按逗号分隔（引号内的逗号不算），去掉引号与空白 */
export function parseFontStack(value: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 量一段 CSS font 简写（如 `48px "X", serif`）的文字宽度；拿不到 canvas 时返回 null */
export type MeasureFn = (font: string) => number | null

const PROBE = 'mmmmmmmmmmlli中文測試ABC123永和'
const BASELINES = ['monospace', 'serif', 'sans-serif'] as const

export type FontStatus = 'installed' | 'missing' | 'generic' | 'unknown'

export function fontStatus(name: string, measure: MeasureFn): FontStatus {
  if (isGenericFamily(name)) return 'generic'
  for (const base of BASELINES) {
    const plain = measure(`48px ${base}`)
    const withFont = measure(`48px "${name}", ${base}`)
    if (plain === null || withFont === null) return 'unknown'
    if (Math.abs(plain - withFont) > 0.01) return 'installed'
  }
  return 'missing'
}

export interface StackItem {
  name: string
  status: FontStatus
}

export interface StackReport {
  items: StackItem[]
  /** 实际生效：第一个已安装的具名字体；一个都没有则为 null（走通用回退） */
  active: string | null
  /** 具名字体里一个都没检测到（含全部 unknown 以外的情形）：显示效果取决于系统默认字体 */
  noneInstalled: boolean
}

export function checkStack(names: readonly string[], measure: MeasureFn): StackReport {
  const items = names.map((name) => ({ name, status: fontStatus(name, measure) }))
  const active = items.find((i) => i.status === 'installed')?.name ?? null
  const named = items.filter((i) => i.status !== 'generic')
  const noneInstalled = named.length > 0 && !named.some((i) => i.status === 'installed' || i.status === 'unknown')
  return { items, active, noneInstalled }
}

/** 浏览器里的真实测量函数；没有 DOM / 没有 canvas（如 jsdom）时恒返回 null → 状态为 unknown */
export function canvasMeasure(): MeasureFn {
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  return (font) => {
    if (!ctx) return null
    ctx.font = font
    return ctx.measureText(PROBE).width
  }
}
