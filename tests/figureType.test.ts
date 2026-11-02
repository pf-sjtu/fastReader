/**
 * 「图」的排版治理守卫（与 tests/designSystem.test.ts 分工：那个管 UI/正文的 token 与角色类，这个管图）。
 *
 * 图活在三个继承不到宿主 CSS 的地方——SVG data URI、iframe 沙箱文档、离线学习包 HTML——
 * 它们只能写具体值，所以必须**只有一个具体值来源**（`src/lib/figureType.ts`），否则又会各写一套。
 * 曾经的问题：mermaid 用 `fontFamily: 'inherit'`（图片文档继承不到 → 等于没写），
 * 加上 mermaid 默认把 SVG 拉满容器，同一个 16px 在图上显示成 15–54px（正文只有 15px）。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIGURE_FONT_STACK, MIN_FIGURE_TEXT_PX, figureFit, svgNaturalSize, readFigureType } from '../src/lib/figureType'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

/** 从 index.css 里取某个 CSS 变量的字面值 */
function cssVar(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(read('src/index.css'))
  if (!m) throw new Error(`index.css 里找不到 ${name}`)
  return m[1].trim()
}

describe('图的排版：唯一来源与跟随正文', () => {
  it('字体栈常量的值与 index.css 的 --font-sans 逐字一致', () => {
    expect(FIGURE_FONT_STACK.trim()).toBe(cssVar('--font-sans'))
  })

  it('兜底值与 index.css 的 --base-font-size 一致（拿不到 CSS 变量时不至于跑偏）', () => {
    const base = Number.parseFloat(cssVar('--base-font-size'))
    expect(readFigureType(null).basePx).toBe(base)
    // node 环境没有 DOM → 用兜底值；字号 = base × scale
    expect(readFigureType(null).textPx).toBe(base)
  })

  it('图内字号 = --base-font-size × --font-scale（用户改字号后重渲即可跟上）', () => {
    const withTokens = (vars: Record<string, string>) => {
      const g = globalThis as unknown as { getComputedStyle?: unknown }
      const prev = g.getComputedStyle
      g.getComputedStyle = () => ({ getPropertyValue: (k: string) => vars[k] ?? '' })
      try {
        return readFigureType({} as Element)
      } finally {
        g.getComputedStyle = prev
      }
    }
    expect(withTokens({ '--base-font-size': '15px', '--font-scale': '1.5' }).textPx).toBeCloseTo(22.5)
    expect(withTokens({ '--base-font-size': '18px', '--font-scale': '0.5' }).textPx).toBeCloseTo(9)
    // 变量缺失 / 非法 → 回到兜底值（9px 那种会被当成非法吗？9 是合法正数，会被采用）
    expect(withTokens({}).textPx).toBe(15)
    expect(withTokens({ '--base-font-size': 'abc', '--font-scale': '0' }).textPx).toBe(15)
    // 字体栈也是从 token 读的（拿不到才用常量兜底）
    expect(withTokens({ '--font-sans': '"自定义", sans-serif' }).fontStack).toBe('"自定义", sans-serif')
  })

  it('唯一的字体栈常量出现在每个「拍平了 CSS」的地方，没人再自己写一套', () => {
    // 这几处的产物脱离宿主 CSS：mermaid / 自绘 SVG 必须写常量，沙箱文档从 token 拷值
    for (const f of ['src/lib/mermaidRender.ts', 'src/study/exportFigures.ts']) {
      expect(read(f), `${f} 应该引用 FIGURE_FONT_STACK`).toContain('FIGURE_FONT_STACK')
    }
    expect(read('src/lib/htmlSandbox.ts')).toContain('readFigureType')
    // 学习包是独立 HTML 文档：内嵌样式表用同一个常量插值
    expect(read('src/study/pack/buildPack.ts')).toContain('font-family: ${FIGURE_FONT_STACK}')
    // 反向：全仓不允许再出现「system-ui 打头的另一套栈」（常量本身除外）
    const offenders: string[] = []
    for (const f of ['src/lib/htmlSandbox.ts', 'src/lib/mermaidRender.ts', 'src/study/exportFigures.ts', 'src/study/pack/buildPack.ts', 'src/study/pack/richStatic.ts', 'src/components/EpubReader.tsx']) {
      const body = read(f).replace(/^import .*$/gm, '')
      if (/system-ui\s*,\s*(-apple-system|"Segoe|BlinkMac)/.test(body)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('mermaid 不再请求「拉满容器宽」，也不再靠 inherit 取字体', () => {
    const src = read('src/lib/mermaidRender.ts')
    expect(src).toContain('useMaxWidth: false')
    expect(src).not.toContain("fontFamily: 'inherit'")
    // 主题或字号变化都要重新 initialize（字号写进 SVG，不重建就是旧字号）
    expect(src).toContain('lastInit')
  })

  it('沙箱文档的字体取自 token，不再硬编码 14px + system-ui', () => {
    const src = read('src/lib/htmlSandbox.ts')
    expect(src).toContain('readFigureType()')
    expect(src).not.toMatch(/font:14px\/1\.6 system-ui/)
  })
})

describe('figureFit：不放大、缩到可读下限为止', () => {
  const t = MIN_FIGURE_TEXT_PX
  it('窄图保持原尺寸（不再被拉满容器）', () => {
    // 220px 的 stateDiagram 放进 747px 容器：曾放大 3.39×，现在是 1×
    expect(figureFit({ naturalW: 220, containerW: 747, textPx: 15 })).toBe(1)
    expect(figureFit({ naturalW: 552, containerW: 747, textPx: 15 })).toBe(1)
  })

  it('超宽时缩小，但停在「文字恰好可读」的倍率上（多出的宽度交给横滚）', () => {
    const f = figureFit({ naturalW: 1400, containerW: 700, textPx: 15 })
    expect(f).toBeCloseTo(t / 15, 5) // 0.733…，而不是 0.5
    expect(15 * f).toBeGreaterThanOrEqual(t)
    expect(1400 * f).toBeGreaterThan(700) // 比容器宽 → 外层 overflow-x-auto 生效
  })

  it('刚好放得下时就是容器比（缩放不会低于 1）', () => {
    expect(figureFit({ naturalW: 700, containerW: 700, textPx: 15 })).toBe(1)
    expect(figureFit({ naturalW: 900, containerW: 700, textPx: 15 })).toBeCloseTo(700 / 900, 5)
  })

  it('用户把字号调得很小时不额外缩小（否则越缩越小）', () => {
    expect(figureFit({ naturalW: 1400, containerW: 700, textPx: 7.5 })).toBe(1)
  })

  it('拿不到容器宽 / 尺寸异常 → 不缩放', () => {
    expect(figureFit({ naturalW: 900, containerW: 0, textPx: 15 })).toBe(1)
    expect(figureFit({ naturalW: 0, containerW: 700, textPx: 15 })).toBe(1)
    expect(figureFit({ naturalW: 900, containerW: 700, textPx: 0 })).toBe(1)
  })
})

describe('svgNaturalSize：从 mermaid 产物取原始尺寸', () => {
  it('优先用 width/height 属性', () => {
    expect(svgNaturalSize('<svg width="220" height="254" viewBox="0 0 220 254"></svg>')).toEqual({ w: 220, h: 254 })
  })
  it('没有尺寸属性就退回 viewBox（mermaid 的 useMaxWidth:false 会给 width/height，这是兜底）', () => {
    expect(svgNaturalSize('<svg viewBox="4 4 552 64"></svg>')).toEqual({ w: 552, h: 64 })
  })
  it('取不到 → null（调用方按不缩放处理）', () => {
    expect(svgNaturalSize('<svg></svg>')).toBeNull()
  })
})
