/**
 * CSS 颜色 → #rrggbb（canvas / SVG 可用）。
 *
 * 为什么要有这个模块：图（mermaid 的 SVG data URI）、canvas（导出的 PNG）、iframe 沙箱这些
 * 地方**读不到宿主 CSS 变量**，必须写具体色值；而「具体色值」的来源只能是主题 token。
 * 这里负责把 token（可能是 oklch / color-mix / var()）解析成 sRGB hex。
 *
 * 纯 DOM 依赖，无 React，可在 node 环境测试。
 */

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

