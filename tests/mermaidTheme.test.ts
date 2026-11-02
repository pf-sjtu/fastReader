import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { oklchToHex, mixOklab, colorsClose } from './__helpers__/color'
import { resolve } from 'node:path'
import {
  FALLBACK_TOKENS_DARK,
  FALLBACK_TOKENS_LIGHT,
  mermaidThemeVariables,
  readThemeTokens,
  THEME_TOKEN_NAMES,
  type ThemeTokens,
} from '@/lib/mermaidTheme'

/**
 * 图内配色必须跟随品牌（宣纸 / 松烟墨 / 朱砂），不能停在 mermaid 默认的蓝紫体系。
 * 图是图片文档，读不到宿主 CSS，所以颜色只能以字面量写进 SVG —— 写错就永远错。
 */

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8')

function blockVars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return {}
  const end = css.indexOf('\n}', start)
  const out: Record<string, string> = {}
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

describe('mermaid 图内配色', () => {
  it('每个可见位置都由品牌 token 决定，不留 mermaid 默认色', () => {
    const v = mermaidThemeVariables({
      tokens: FALLBACK_TOKENS_LIGHT,
      fontStack: '"PingFang SC", sans-serif',
      fontSizePx: 15,
    })
    // 节点 / 簇 / 边 / 标签 / 时序图 / 状态图 / 注释都要有值
    for (const key of [
      'background',
      'mainBkg',
      'textColor',
      'titleColor',
      'primaryColor',
      'primaryTextColor',
      'primaryBorderColor',
      'secondaryColor',
      'tertiaryColor',
      'lineColor',
      'nodeBorder',
      'edgeLabelBackground',
      'labelBoxBkgColor',
      'clusterBkg',
      'clusterBorder',
      'actorBkg',
      'actorBorder',
      'signalColor',
      'activationBkgColor',
      'noteBkgColor',
      'noteBorderColor',
      'stateBkg',
      'stateBorder',
      'stateLabelColor',
    ]) {
      expect(v[key], `缺 ${key}`).toBeTruthy()
      expect(v[key], `${key} 不能是 mermaid 默认蓝紫`).not.toMatch(/^#(ECECFF|9370DB|C8DAFC|333|aaa)/i)
    }
  })

  it('字体与字号交给调用方（与正文同栈同字号）', () => {
    const v = mermaidThemeVariables({
      tokens: FALLBACK_TOKENS_LIGHT,
      fontStack: '"PingFang SC", sans-serif',
      fontSizePx: 19.5,
    })
    expect(v.fontFamily).toBe('"PingFang SC", sans-serif')
    expect(v.fontSize).toBe('19.5px')
  })

  it('深浅两套的主色不同（主题切换会换色）', () => {
    const light = mermaidThemeVariables({ tokens: FALLBACK_TOKENS_LIGHT, fontStack: 'x', fontSizePx: 15 })
    const dark = mermaidThemeVariables({ tokens: FALLBACK_TOKENS_DARK, fontStack: 'x', fontSizePx: 15 })
    expect(light.primaryBorderColor).not.toBe(dark.primaryBorderColor)
    expect(light.mainBkg).not.toBe(dark.mainBkg)
  })

  it('兜底色表完整（每个 token 都有值）', () => {
    for (const name of THEME_TOKEN_NAMES) {
      expect(FALLBACK_TOKENS_LIGHT[name], `浅色缺 ${name}`).toMatch(/^#[0-9a-f]{6}$/)
      expect(FALLBACK_TOKENS_DARK[name], `深色缺 ${name}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('淡底 token 的兜底值 = 状态色与卡片底按 index.css 的比例混合的结果', () => {
    // index.css: --primary-muted: color-mix(in oklab, var(--primary) 14%, var(--card))
    const light = blockVars(':root')
    const check = (name: string, base: string, pct: number, card = 'card') => {
      const baseHex = oklchToHex(light[base])!
      const cardHex = oklchToHex(light[card])!
      const want = mixOklab(baseHex, cardHex, pct)
      const got = FALLBACK_TOKENS_LIGHT[name]
      expect(colorsClose(got, want), `${name}: ${got} vs ${want}`).toBe(true)
    }
    check('primary-muted', 'primary', 0.14)
    check('success-muted', 'success', 0.14)
    check('warning-muted', 'warning', 0.14)
    check('info-muted', 'info', 0.14)
    check('destructive-muted', 'destructive', 0.14)
  })

  it('index.css 里每个 token 都有定义（名字对得上）', () => {
    const light = blockVars(':root')
    const dark = blockVars('.dark')
    for (const name of THEME_TOKEN_NAMES) {
      expect(light[name], `:root 缺 --${name}`).toBeTruthy()
      expect(dark[name], `.dark 缺 --${name}`).toBeTruthy()
    }
  })

  it('读不到 DOM 时退回兜底值，不会抛错', () => {
    const t = readThemeTokens(false, null)
    expect(t.primary).toBe(FALLBACK_TOKENS_LIGHT.primary)
  })

  it('读得到 DOM 时优先用真实 token', () => {
    // jsdom 没有 canvas，color-mix 解析不了 → 至少基础色（oklch 走 DOM 解析）能拿到真值
    const t = readThemeTokens(false, document.documentElement)
    expect(t.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(Object.keys(t)).toHaveLength(THEME_TOKEN_NAMES.length)
  })

  it('themeVariables 的每个值都是合法颜色（不会把无效值写进 SVG）', () => {
    const v: ThemeTokens = FALLBACK_TOKENS_DARK
    const out = mermaidThemeVariables({ tokens: v, fontStack: 'x', fontSizePx: 15 })
    for (const [k, val] of Object.entries(out)) {
      if (k === 'fontFamily') continue
      if (k === 'fontSize') {
        expect(val, k).toMatch(/^\d+(\.\d+)?px$/)
        continue
      }
      if (k === 'dropShadow') {
        // 投影是 CSS filter 字符串（mermaid 的 dropShadow 变量就是这个形状）
        expect(val, k).toMatch(/^drop-shadow\(/)
        continue
      }
      expect(val, k).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
