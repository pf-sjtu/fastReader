import { describe, it, expect, vi } from 'vitest'
import { afterEach } from 'vitest'
import { mount, click, waitFor } from './uiTestUtils'
import ReactMarkdown from 'react-markdown'
import { richMarkdownComponents } from '@/components/markdown/richComponents'
import { buildSandboxDoc, HTML_MAX } from '@/lib/htmlSandbox'

const renderMermaid = vi.fn()
vi.mock('@/lib/mermaidRender', () => ({
  renderMermaid: (...a: unknown[]) => renderMermaid(...a),
  svgToDataUri: (s: string) => 'data:image/svg+xml,' + encodeURIComponent(s),
}))
vi.mock('@/components/useTheme', () => ({ useIsDarkMode: () => false }))

const F = '```'
let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const md = (s: string) => {
  m?.unmount()
  m = mount(<ReactMarkdown components={richMarkdownComponents}>{s}</ReactMarkdown>)
  return m
}
const has = (t: string) => document.body.textContent?.includes(t) ?? false
const btn = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)

describe('富内容块渲染', () => {
  it('genui：渲染成组件；测验可交互并判分', () => {
    const q = JSON.stringify({ type: 'quiz', question: '谁先到？', options: ['甲', '乙'], answer: 1, explain: '乙更快' })
    md(`正文\n\n${F}genui\n${q}\n${F}\n`)
    expect(has('谁先到？')).toBe(true)
    click(btn('乙'))
    expect(has('乙更快')).toBe(true)
  })

  it('genui：JSON 坏了回退为源码并给出提示，正文不受影响', () => {
    md(`前文\n\n${F}genui\n{坏的\n${F}\n\n后文`)
    expect(has('前文') && has('后文')).toBe(true)
    expect(document.querySelector('[data-slot="rich-fallback"]')?.textContent).toContain('JSON 无法解析')
  })

  it('mermaid：成功 → 图片；失败 → 源码回退', async () => {
    renderMermaid.mockResolvedValueOnce({ ok: true, svg: '<svg/>' })
    md(`${F}mermaid\ngraph LR\nA-->B\n${F}`)
    await waitFor(() => expect(document.querySelector('[data-slot="mermaid"] img')).toBeTruthy())
    renderMermaid.mockResolvedValueOnce({ ok: false, error: 'Parse error' })
    md(`${F}mermaid\ngraph ???\n${F}`)
    await waitFor(() => expect(document.querySelector('[data-slot="rich-fallback"]')?.textContent).toContain('Parse error'))
  })

  it('html：沙箱 iframe 只开 allow-scripts，不带 same-origin', () => {
    md(`${F}html\n<button>点我</button>\n${F}`)
    const f = document.querySelector('iframe')!
    expect(f.getAttribute('sandbox')).toBe('allow-scripts')
    expect(f.getAttribute('srcdoc')).toContain('点我')
  })

  it('普通代码块不被接管', () => {
    md(`${F}python\nprint(1)\n${F}`)
    expect(document.querySelector('[data-slot="rich-fallback"], iframe, [data-slot="genui"]')).toBeNull()
    expect(has('print(1)')).toBe(true)
  })
})

describe('buildSandboxDoc', () => {
  it('带 CSP；剔除 iframe/object/form/meta/link/base 等危险标签；保留交互脚本', () => {
    const r = buildSandboxDoc('<iframe src="https://x"></iframe><form action="/x"></form><meta http-equiv="refresh" content="0;url=x"><base href="x"><link rel="stylesheet" href="x"><p id="a">好</p><script>document.getElementById("a")</script>')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc).toContain("default-src 'none'")
    expect(r.doc).not.toMatch(/<iframe|<form|refresh|<base|<link/)
    expect(r.doc).toContain('<p id="a">好</p>')
    expect(r.doc).toContain('getElementById')
  })
  it('空 / 过大 → 失败', () => {
    expect(buildSandboxDoc('  ').ok).toBe(false)
    expect(buildSandboxDoc('x'.repeat(HTML_MAX + 1)).ok).toBe(false)
  })
})
