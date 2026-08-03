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

/** 暖灰褐主题回退（与 index.css Demo A 对齐的 hex） */
const FALLBACK_LIGHT: ChartThemeColors = {
  primary: '#4a433c',
  primaryForeground: '#f4f0ea',
  foreground: '#3d3832',
  mutedForeground: '#8a8178',
  card: '#ffffff',
  border: '#d4ccc2',
  accent: '#c9bfb3',
  accentForeground: '#3d3832',
  palette: ['#8b7355', '#a0674a', '#6b7a4e', '#9a7b4f', '#7a6550', '#a35a45'],
  isDark: false,
}

const FALLBACK_DARK: ChartThemeColors = {
  primary: '#e8e8e8',
  primaryForeground: '#1a1a1a',
  foreground: '#ececec',
  mutedForeground: '#9a9a9a',
  card: '#2a2a2a',
  border: '#4a4a4a',
  accent: '#3a3a3a',
  accentForeground: '#ececec',
  palette: ['#b8956a', '#c47a5a', '#8a9a6a', '#c4a66a', '#a08070', '#c07060'],
  isDark: true,
}

/**
 * 任意 CSS 颜色 → #rrggbb（cytoscape / canvas 可用）
 * 通过临时 DOM 让浏览器解析 oklch / var() 等
 */
export function cssColorToHex(input: string, fallback = '#666666'): string {
  const raw = (input || '').trim()
  if (!raw) return fallback
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1)
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (typeof document === 'undefined') return fallback

  const el = document.createElement('div')
  el.style.color = ''
  el.style.color = raw
  // 未挂载时部分浏览器也能解析；挂到 body 更稳
  el.style.position = 'absolute'
  el.style.visibility = 'hidden'
  el.style.pointerEvents = 'none'
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)

  const m = computed.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)/i
  )
  if (!m) return fallback
  const r = Math.round(Number(m[1]))
  const g = Math.round(Number(m[2]))
  const b = Math.round(Number(m[3]))
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

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

/** 在浏览器中读取当前主题；全部输出 #rrggbb */
export function readChartTheme(el?: Element | null): ChartThemeColors {
  if (typeof document === 'undefined') return FALLBACK_LIGHT

  const isDark = document.documentElement.classList.contains('dark')
  const fb = isDark ? FALLBACK_DARK : FALLBACK_LIGHT
  const rootStyle = getComputedStyle(document.documentElement)
  // 优先 root：主题变量定义在 :root / .dark
  const style = el ? getComputedStyle(el as Element) : rootStyle

  const chartKeys = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const
  const basePalette = chartKeys.map((k, i) =>
    readCssVarAsHex(rootStyle, k, fb.palette[i] || fb.primary)
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
    palette: [...basePalette, ...basePalette],
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
