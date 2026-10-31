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
  palette: [
    '#b5321f', '#2a4f8c', '#a67c1a', '#3f7d4e', '#6a3f8c',
    '#2f7d8c', '#b02e52', '#6b4a32', '#7d8a2f', '#a8508f',
  ],
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
  palette: [
    '#e8785c', '#7ea2e6', '#e0b84a', '#6fc08a', '#b48ae0',
    '#5fc0d0', '#e8708f', '#b08a68', '#b8c85a', '#d98ac0',
  ],
  isDark: true,
}

let probeCtx: CanvasRenderingContext2D | null | undefined

function canvasColorToHex(css: string): string | null {
  try {
    if (probeCtx === undefined) {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      probeCtx = c.getContext('2d', { willReadFrequently: true })
    }
    const ctx = probeCtx
    if (!ctx) return null
    // 非法颜色会被 fillStyle 忽略并保留上一次的值：先写入一个哨兵色再比较，避免误读
    ctx.fillStyle = '#010203'
    ctx.fillStyle = css
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) return null
    if (r === 1 && g === 2 && b === 3) return null
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
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

  // 首选 canvas：现代浏览器的 getComputedStyle 会保留 oklch()/color-mix() 原样，
  // 下面的 rgb() 正则就匹配不上；把颜色画到 1×1 画布再读像素，得到的一定是 sRGB。
  // jsdom 没有 canvas（getContext 返回 null），自然退回 DOM 解析。
  const viaCanvas = canvasColorToHex(raw)
  if (viaCanvas) return viaCanvas

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

/**
 * 把 `var(--entity-3)` 这类 CSS 变量引用（或任意 CSS 颜色）解析成 #rrggbb。
 * canvas 库（cytoscape）不认 CSS 变量/oklch，而实体色唯一来源是 index.css 的 --entity-N，
 * 所以在运行时按当前明/暗主题解析，主题切换后重新调用即可。
 */
export function resolveCssVarColor(value: string, fallback = '#666666'): string {
  const m = value.trim().match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (!m || typeof document === 'undefined') return cssColorToHex(value, fallback)
  return readCssVarAsHex(getComputedStyle(document.documentElement), m[1], fallback)
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
