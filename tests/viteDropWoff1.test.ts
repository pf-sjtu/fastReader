import { describe, it, expect } from 'vitest'
import { dropWoff1, stripWoff1 } from '../config/vite-drop-woff1'

const face = (name: string, extra = '') =>
  `@font-face {\n  font-family: 'Noto Serif SC';\n  src: url(./files/${name}.woff2) format('woff2'), url(./files/${name}.woff) format('woff');${extra}\n  unicode-range: U+4e00-4e2f;\n}`

describe('stripWoff1：只保留 woff2', () => {
  it('去掉 woff 引用，保留 woff2 与其他声明', () => {
    const out = stripWoff1(face('noto-serif-sc-5-600-normal'))
    expect(out).toContain("url(./files/noto-serif-sc-5-600-normal.woff2) format('woff2');")
    expect(out).not.toContain('.woff)')
    expect(out).not.toContain("format('woff')")
    expect(out).toContain('unicode-range: U+4e00-4e2f;')
  })

  it('一个文件里有多个 @font-face 时每个都处理；双引号写法也认', () => {
    const css = `${face('a')}\n${face('b').replaceAll("'", '"')}`
    const out = stripWoff1(css)
    expect(out.match(/\.woff2\)/g)).toHaveLength(2)
    expect(out).not.toMatch(/\.woff\)/)
  })

  it('没有 woff 的 CSS 原样返回', () => {
    const css = '.a { color: red; src: url(x.woff2) format("woff2"); }'
    expect(stripWoff1(css)).toBe(css)
  })
})

describe('dropWoff1 插件：只处理 @fontsource 的 CSS', () => {
  const run = (id: string, code: string) => (dropWoff1().transform as (c: string, i: string) => { code: string } | null)(code, id)
  it('匹配 @fontsource 下的 css（含 Windows 路径与 ?query）', () => {
    expect(run('/n/node_modules/@fontsource/noto-serif-sc/600.css', face('x'))?.code).not.toContain('.woff)')
    expect(run('C:\\n\\node_modules\\@fontsource\\noto-serif-sc\\600.css?used', face('x'))?.code).not.toContain('.woff)')
  })
  it('其他文件不动（返回 null）', () => {
    expect(run('/src/index.css', face('x'))).toBeNull()
    expect(run('/n/node_modules/@fontsource/noto-serif-sc/index.js', 'x')).toBeNull()
  })
})
