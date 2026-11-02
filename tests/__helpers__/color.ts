/**
 * 测试用的颜色换算：把 index.css 里的 oklch / color-mix 换算成 sRGB hex。
 *
 * 为什么需要：主题 token 用 oklch 写，而图表回退色、图内配色这些「读不到 CSS 变量」的地方
 * 必须写死 hex。守卫要证明两边一致，就得在 node 环境里把 oklch 算出来对比。
 *
 * 精度：与浏览器解析的差异 ≤1/255（取整误差），所以断言用 ±2 容差。
 */

/** OKLCH → #rrggbb */
export function oklchToHex(raw: string): string | null {
  const m = raw.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/)
  if (!m) return null
  const L = Number(m[1])
  const C = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3
  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return '#' + lin.map(gamma).map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** #rrggbb → [r, g, b] */
export function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

/** 两个 hex 是否在 ±tol/255 内相等 */
export function colorsClose(a: string, b: string, tol = 2): boolean {
  const x = rgb(a)
  const y = rgb(b)
  return x.every((v, i) => Math.abs(v - y[i]) <= tol)
}

/** OKLab 混合：color-mix(in oklab, A pct%, B) */
export function mixOklab(hexA: string, hexB: string, pct: number): string {
  const toOklab = (hex: string) => {
    const v = rgb(hex).map((c) => c / 255)
    const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const [r, g, b] = lin
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
  }
  const toSrgb = (lab: number[]) => {
    const [L, a, bb] = lab
    const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
    const out = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    return out.map((c) => {
      const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
      return Math.round(Math.min(1, Math.max(0, v)) * 255)
    })
  }
  const A = toOklab(hexA)
  const B = toOklab(hexB)
  const mixed = A.map((a, i) => a * pct + B[i] * (1 - pct))
  return '#' + toSrgb(mixed).map((v) => v.toString(16).padStart(2, '0')).join('')
}
