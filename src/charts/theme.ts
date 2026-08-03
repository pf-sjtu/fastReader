/**
 * 从 CSS 变量读取图表主题色（适配 light / dark）
 * getComputedStyle 会把 oklch 解析为浏览器可用的 rgb(...)
 */

export interface ChartThemeColors {
  primary: string
  primaryForeground: string
  foreground: string
  mutedForeground: string
  card: string
  border: string
  accent: string
  accentForeground: string
  /** 实体色板：chart-1..5 循环加深 */
  palette: string[]
  isDark: boolean
}

const FALLBACK_LIGHT: ChartThemeColors = {
  primary: 'oklch(0.3438 0.0124 72.4)',
  primaryForeground: 'oklch(0.9576 0.0086 67.7)',
  foreground: 'oklch(0.2801 0.0080 59.3)',
  mutedForeground: 'oklch(0.6031 0.0211 67.4)',
  card: '#ffffff',
  border: 'oklch(0.8491 0.0152 70.9)',
  accent: 'oklch(0.8491 0.0152 70.9)',
  accentForeground: 'oklch(0.2801 0.0080 59.3)',
  palette: [
    'oklch(0.45 0.06 65)',
    'oklch(0.48 0.08 30)',
    'oklch(0.42 0.05 85)',
    'oklch(0.50 0.07 45)',
    'oklch(0.40 0.04 75)',
    'oklch(0.46 0.06 20)',
  ],
  isDark: false,
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim()
  return v || fallback
}

/** 在浏览器中读取当前主题；SSR/无 document 时返回暖灰褐回退 */
export function readChartTheme(el?: Element | null): ChartThemeColors {
  if (typeof document === 'undefined') return FALLBACK_LIGHT

  const target = (el as HTMLElement) || document.documentElement
  const style = getComputedStyle(target)
  const rootStyle = getComputedStyle(document.documentElement)
  const isDark = document.documentElement.classList.contains('dark')

  const chartKeys = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const
  const basePalette = chartKeys.map((k, i) =>
    cssVar(rootStyle, k, FALLBACK_LIGHT.palette[i] || FALLBACK_LIGHT.primary)
  )
  // 扩展到 12 色：原色 + 略调 lightness 的变体（仍同源）
  const palette = [
    ...basePalette,
    ...basePalette.map((c, i) => c), // 重复用 CSS 变量原值；实体多时循环
  ]

  return {
    primary: cssVar(style, '--primary', FALLBACK_LIGHT.primary),
    primaryForeground: cssVar(style, '--primary-foreground', FALLBACK_LIGHT.primaryForeground),
    foreground: cssVar(style, '--foreground', FALLBACK_LIGHT.foreground),
    mutedForeground: cssVar(style, '--muted-foreground', FALLBACK_LIGHT.mutedForeground),
    card: cssVar(style, '--card', FALLBACK_LIGHT.card),
    border: cssVar(style, '--border', FALLBACK_LIGHT.border),
    accent: cssVar(style, '--accent', FALLBACK_LIGHT.accent),
    accentForeground: cssVar(style, '--accent-foreground', FALLBACK_LIGHT.accentForeground),
    palette: palette.length ? palette : FALLBACK_LIGHT.palette,
    isDark,
  }
}

/** 订阅 html.dark 切换 */
export function subscribeThemeChange(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        cb()
        break
      }
    }
  })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
