/**
 * 从 CSS 变量读取图表主题色（适配 light / dark）
 * Cytoscape 等 canvas 库不认 oklch，需转成 #rrggbb
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
  /** 实体色板 #rrggbb */
  palette: string[]
  isDark: boolean
}

/**
 * 主题回退值：与 index.css 的 :root / .dark token 逐一对应（由浏览器实测解析出的 sRGB hex）。
 * 读取 CSS 变量失败时（无 DOM、SSR）用它们兜底，所以**改了 index.css 的 token 也要同步这里**——
 * tests/chartTheme.test.ts 会核对两组值是否与 index.css 的 token 一致。
 */
export const FALLBACK_LIGHT: ChartThemeColors = {
  primary: '#b4341f',
  primaryForeground: '#fbf4ea',
  foreground: '#251f1c',
  mutedForeground: '#6c6158',
  card: '#fdfbf7',
  border: '#dad1c7',
  accent: '#efdbcf',
  accentForeground: '#251f1c',
  palette: [
    '#b6341f', '#285994', '#9f7101', '#337344', '#664689',
    '#00717c', '#a92e52', '#6d4a2c', '#6d7533', '#9b5c87',
  ],
  isDark: false,
}

export const FALLBACK_DARK: ChartThemeColors = {
  primary: '#e4694b',
  primaryForeground: '#14100d',
  foreground: '#e9e4dc',
  mutedForeground: '#9b948c',
  card: '#1d1816',
  border: '#38312e',
  accent: '#3b2824',
  accentForeground: '#e9e4dc',
  palette: [
    '#f07456', '#6ea1e2', '#e4b750', '#76be86', '#b593dc',
    '#61bfc9', '#f17993', '#b98e6c', '#b5bf73', '#d995c2',
  ],
  isDark: true,
}

import { cssColorToHex, resolveCssVarColor } from '@/lib/cssColor'

// 对外 API 不变：图表与其它模块仍从这里取色
export { cssColorToHex, resolveCssVarColor }

function readCssVarAsHex(
  style: CSSStyleDeclaration,
  name: string,
  fallbackHex: string
): string {
  const v = style.getPropertyValue(name).trim()
  if (!v) return fallbackHex
  // 自定义属性常是 oklch(...)，需经浏览器解析
  return cssColorToHex(v, fallbackHex)
}

/** 在给定底色上该用深字还是浅字（WCAG 相对亮度，阈值取使两侧对比度大致相等的 ≈0.179） */
export function readableTextOn(hex: string, dark = '#1f1a16', light = '#ffffff'): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return light
  const lin = (v: string) => {
    const c = parseInt(v, 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3])
  return L > 0.179 ? dark : light
}

/** 在浏览器中读取当前主题；全部输出 #rrggbb。主题变量定义在 :root / .dark，统一从 root 读取 */
export function readChartTheme(): ChartThemeColors {
  if (typeof document === 'undefined') return FALLBACK_LIGHT

  const isDark = document.documentElement.classList.contains('dark')
  const fb = isDark ? FALLBACK_DARK : FALLBACK_LIGHT
  const rootStyle = getComputedStyle(document.documentElement)

  // 实体色 token（index.css --entity-1..10），与正文标注、人物志同源
  const palette = fb.palette.map((hex, i) =>
    readCssVarAsHex(rootStyle, `--entity-${i + 1}`, hex)
  )

  return {
    primary: readCssVarAsHex(rootStyle, '--primary', fb.primary),
    primaryForeground: readCssVarAsHex(
      rootStyle,
      '--primary-foreground',
      fb.primaryForeground
    ),
    foreground: readCssVarAsHex(rootStyle, '--foreground', fb.foreground),
    mutedForeground: readCssVarAsHex(
      rootStyle,
      '--muted-foreground',
      fb.mutedForeground
    ),
    card: readCssVarAsHex(rootStyle, '--card', fb.card),
    border: readCssVarAsHex(rootStyle, '--border', fb.border),
    accent: readCssVarAsHex(rootStyle, '--accent', fb.accent),
    accentForeground: readCssVarAsHex(
      rootStyle,
      '--accent-foreground',
      fb.accentForeground
    ),
    palette,
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
