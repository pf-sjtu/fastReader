import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FALLBACK_LIGHT, FALLBACK_DARK } from '@/charts/theme'

/**
 * 图表回退色必须与 index.css 的 token 同源。
 * 图表读不到 CSS 变量时（无 DOM）用 FALLBACK_*，值若与主题脱节，图表在降级路径下会
 * 与正文配色不一致（旧问题：回退色还是暖灰褐，而主题早已换成朱砂体系）。
 */

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8')

/** 取某个选择器块里的自定义属性 */
function blockVars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return {}
  const end = css.indexOf('\n}', start)
  const body = css.slice(start, end)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

/** OKLCH → sRGB hex（与浏览器解析同公式，尾数取整差 ≤1/255） */
function oklchToHex(raw: string): string | null {
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

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** 容差 2/255：浏览器与公式的取整差异 */
function expectSame(actual: string, expected: string, label: string) {
  const a = rgb(actual)
  const e = rgb(expected)
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(a[i] - e[i]), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(2)
  }
}

const KEYS = [
  'primary',
  'primaryForeground',
  'foreground',
  'mutedForeground',
  'card',
  'border',
  'accent',
  'accentForeground',
] as const

const CSS_KEY: Record<(typeof KEYS)[number], string> = {
  primary: 'primary',
  primaryForeground: 'primary-foreground',
  foreground: 'foreground',
  mutedForeground: 'muted-foreground',
  card: 'card',
  border: 'border',
  accent: 'accent',
  accentForeground: 'accent-foreground',
}

describe('图表回退色与 index.css 同源', () => {
  const lightVars = blockVars(':root')
  const darkVars = blockVars('.dark')

  it('两套 token 都存在', () => {
    expect(Object.keys(lightVars).length).toBeGreaterThan(20)
    expect(Object.keys(darkVars).length).toBeGreaterThan(20)
  })

  for (const [label, vars, fallback] of [
    ['浅色', lightVars, FALLBACK_LIGHT],
    ['深色', darkVars, FALLBACK_DARK],
  ] as const) {
    it(`${label}的基础色与 token 一致`, () => {
      for (const key of KEYS) {
        const raw = vars[CSS_KEY[key]]
        expect(raw, `${label} 缺 --${CSS_KEY[key]}`).toBeTruthy()
        const hex = oklchToHex(raw)
        expect(hex, `${label} --${CSS_KEY[key]} 不是 oklch：${raw}`).toBeTruthy()
        expectSame(fallback[key], hex!, `${label} --${CSS_KEY[key]}`)
      }
    })

    it(`${label}的实体色板与 token 一致`, () => {
      expect(fallback.palette.length).toBe(10)
      fallback.palette.forEach((hex, i) => {
        const raw = vars[`entity-${i + 1}`]
        expect(raw, `${label} 缺 --entity-${i + 1}`).toBeTruthy()
        const want = oklchToHex(raw)
        expect(want, `${label} --entity-${i + 1} 不是 oklch：${raw}`).toBeTruthy()
        expectSame(hex, want!, `${label} --entity-${i + 1}`)
      })
    })
  }

  it('深浅两套回退色不同（别把两套写成同一份）', () => {
    expect(FALLBACK_LIGHT.primary).not.toBe(FALLBACK_DARK.primary)
    expect(FALLBACK_LIGHT.card).not.toBe(FALLBACK_DARK.card)
    expect(FALLBACK_LIGHT.isDark).toBe(false)
    expect(FALLBACK_DARK.isDark).toBe(true)
  })
})
