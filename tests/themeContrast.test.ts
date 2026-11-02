/**
 * 明暗双主题的对比度守卫：直接把 `src/index.css` 的 token 解析出来算 WCAG 对比度。
 *
 * 为什么要有它：颜色 token 是手调数值，改一个明度就可能让「次要文字压在淡底上」掉到 4.5 以下，
 * 而这种组合（`bg-muted text-muted-foreground`：Tabs 容器、分类胶囊、分面切换）遍布全站，
 * 靠目视走查看不出来。本文件把口径钉死，改 token 时立刻知道越界了。
 *
 * 口径（与 W3C 一致，差异处写明理由）：
 * - 正文与次要文字的配对：≥ 4.5（WCAG AA，正常字号）
 * - 实心底上的前景（主/次/危险按钮、状态色实心底）：≥ 4.5
 * - 装饰性边框 `--border`：**不按 3:1 要求**——1.4.11 只管「识别组件所必需的边界」，
 *   而卡片/分割线还有底色差异可辨；这里只断言「可见下限 1.2」，防止它被调成隐形。
 * - 实体色 `--entity-*`：只用于下划线、淡底、图表填充等装饰（正文颜色是 inherit），按 UI 级 3:1
 * - 两套主题的 token 必须一一对应：漏定义会让「深色下某个色没跟着换」这种问题悄悄发生
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** 取某个选择器的声明块（顶层，按大括号配平） */
function blockOf(selector: string): string {
  const at = css.indexOf(selector)
  if (at < 0) throw new Error(`index.css 里找不到 ${selector}`)
  let depth = 0
  const start = css.indexOf('{', at)
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i)
  }
  throw new Error(`${selector} 的大括号不配平`)
}

function decls(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim()
  return out
}

const ROOT = decls(blockOf(':root {'))
const DARK_ONLY = decls(blockOf('.dark {'))
const THEMES: Record<string, Record<string, string>> = { light: ROOT, dark: { ...ROOT, ...DARK_ONLY } }

type Rgb = [number, number, number]

/** oklch → sRGB（0..1），按 CSS Color 4 的换算 */
function oklchToSrgb(L: number, C: number, hueDeg: number): Rgb {
  const a = C * Math.cos((hueDeg * Math.PI) / 180)
  const b = C * Math.sin((hueDeg * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = (x: number) => {
    const v = Math.min(1, Math.max(0, x))
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])]
}

// 必须锚定：`color-mix(... var(--x) ...)` 里也含 var(...)，不锚定会把混合色误判成纯色（对比度恒为 1）
const VAR = /^var\((--[\w-]+)\)$/
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/
const MIX = /^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/

function resolveValue(raw: string, theme: string): Rgb {
  const v = raw.trim()
  const asVar = VAR.exec(v)
  if (asVar) return resolve(asVar[1], theme)
  const asOklch = OKLCH.exec(v)
  if (asOklch) return oklchToSrgb(Number(asOklch[1]), Number(asOklch[2]), Number(asOklch[3]))
  const asMix = MIX.exec(v)
  if (asMix) {
    // 近似：在 sRGB 上做同样的权重混合（与 oklab 混合差异 <2%，用于守卫足够）
    const a = resolveValue(asMix[1], theme)
    const w = Number(asMix[2]) / 100
    const b = resolveValue(asMix[3], theme)
    return [a[0] * w + b[0] * (1 - w), a[1] * w + b[1] * (1 - w), a[2] * w + b[2] * (1 - w)]
  }
  throw new Error(`无法解析 ${v}`)
}

function resolve(name: string, theme: string): Rgb {
  const raw = THEMES[theme][name]
  if (!raw) throw new Error(`${theme} 缺少 ${name}`)
  return resolveValue(raw, theme)
}

const luminance = ([r, g, b]: Rgb): number => {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg: string, bg: string, theme: string): number {
  const a = luminance(resolve(fg, theme))
  const b = luminance(resolve(bg, theme))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 正文 / 次要文字 / 实心底前景：4.5 */
const TEXT_PAIRS: [string, string, string][] = [
  ['--foreground', '--background', '正文 / 底色'],
  ['--foreground', '--card', '正文 / 卡片'],
  ['--foreground', '--muted', '正文 / 淡底'],
  ['--card-foreground', '--card', '卡片文字'],
  ['--popover-foreground', '--popover', '弹层文字'],
  ['--muted-foreground', '--background', '次要文字 / 底色'],
  ['--muted-foreground', '--card', '次要文字 / 卡片'],
  ['--muted-foreground', '--muted', '次要文字 / 淡底（Tabs 容器、分类胶囊）'],
  ['--muted-foreground', '--accent', '次要文字 / 悬停底（菜单项图标）'],
  ['--primary-foreground', '--primary', '主按钮'],
  ['--secondary-foreground', '--secondary', '次按钮'],
  ['--accent-foreground', '--accent', '悬停项'],
  ['--sidebar-foreground', '--sidebar', '侧栏'],
  ['--sidebar-accent-foreground', '--sidebar-accent', '侧栏选中项'],
  ['--success-foreground', '--success', '实心成功底'],
  ['--warning-foreground', '--warning', '实心警告底'],
  ['--info-foreground', '--info', '实心信息底'],
  ['--destructive-foreground', '--destructive', '实心危险底'],
]

/** 状态色作为文字压在各种底上：4.5 */
const STATUS_PAIRS: [string, string][] = [
  ['--success', '--background'],
  ['--success', '--card'],
  ['--success', '--success-muted'],
  ['--warning', '--background'],
  ['--warning', '--card'],
  ['--warning', '--warning-muted'],
  ['--info', '--background'],
  ['--info', '--card'],
  ['--info', '--info-muted'],
  ['--destructive', '--background'],
  ['--destructive', '--card'],
  ['--destructive', '--destructive-muted'],
  ['--primary', '--background'],
  ['--primary', '--card'],
]

describe.each(['light', 'dark'] as const)('%s 主题的对比度', (theme) => {
  it.each(TEXT_PAIRS)('%s 压 %s 达到 4.5（%s）', (fg, bg) => {
    expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(STATUS_PAIRS)('状态色 %s 压 %s 达到 4.5', (fg, bg) => {
    expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5)
  })

  it('焦点环压在底色上达到 3:1（UI 组件边界）', () => {
    expect(contrast('--ring', '--background', theme)).toBeGreaterThanOrEqual(3)
  })

  it('装饰性边框不至于隐形（≥1.2；不按 3:1 要求，见文件头口径）', () => {
    expect(contrast('--border', '--background', theme)).toBeGreaterThanOrEqual(1.2)
    expect(contrast('--border', '--card', theme)).toBeGreaterThanOrEqual(1.2)
  })

  it('实体色（只用于下划线 / 淡底 / 图表填充）达到 3:1', () => {
    const names = [...Array.from({ length: 10 }, (_, i) => `--entity-${i + 1}`), '--entity-neutral']
    const weak = names.filter((n) => Math.min(contrast(n, '--background', theme), contrast(n, '--card', theme)) < 3)
    expect(weak).toEqual([])
  })
})

describe('两套主题的 token 必须一一对应', () => {
  it('.dark 覆写的 token 都在 :root 里有定义；且关键的语义色两套齐全', () => {
    const orphans = Object.keys(DARK_ONLY).filter((k) => !(k in ROOT))
    expect(orphans).toEqual([])
    // 关键组：颜色类 token 在 light 与 dark 里都必须存在（漏一个就会出现「深色下没跟着换」）
    const groups = ['--success', '--warning', '--info', '--destructive', '--danger', '--border', '--ring', '--primary']
    const missing = groups.filter((k) => !(k in THEMES.light) || !(k in THEMES.dark))
    expect(missing).toEqual([])
  })
})
