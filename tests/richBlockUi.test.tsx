import { describe, it, expect, vi } from 'vitest'
import { afterEach } from 'vitest'
import { mount, click, waitFor } from './uiTestUtils'
import ReactMarkdown from 'react-markdown'
import { richMarkdownComponents } from '@/components/markdown/richComponents'
import { act } from 'react'
import { buildSandboxDoc, DOC_MSG, HEIGHT_MSG, HTML_MAX, READY_MSG, READY_TIMEOUT_MS, SANDBOX_URL } from '@/lib/htmlSandbox'

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

  it('html：沙箱 iframe 只开 allow-scripts，指向独立沙箱页，不用 srcdoc', () => {
    md(`${F}html\n<button>点我</button>\n${F}`)
    const f = document.querySelector('iframe')!
    expect(f.getAttribute('sandbox')).toBe('allow-scripts')
    expect(f.getAttribute('src')).toBe(SANDBOX_URL)
    expect(f.hasAttribute('srcdoc')).toBe(false)
  })

  it('html：握手——就绪后下发整份文档；只认自己 iframe 的消息；高度回报生效', async () => {
    md(`${F}html\n<button>点我</button>\n${F}`)
    const f = document.querySelector('iframe')!
    const win = f.contentWindow!
    const post = vi.spyOn(win, 'postMessage')
    const from = (source: Window | null, data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { source, data }))
      })
    // 陌生来源的 READY 不响应
    from(window, { type: READY_MSG })
    expect(post).not.toHaveBeenCalled()
    from(win, { type: READY_MSG })
    expect(post).toHaveBeenCalledTimes(1)
    const sent = post.mock.calls[0][0] as { type: string; doc: string }
    expect(sent.type).toBe(DOC_MSG)
    expect(sent.doc).toContain('点我')
    // 重复 READY 不再下发
    from(win, { type: READY_MSG })
    expect(post).toHaveBeenCalledTimes(1)
    // 高度：陌生来源忽略；自己的取 ceil+2 并夹在 40..720
    from(window, { type: HEIGHT_MSG, h: 500 })
    expect(f.style.height).toBe('120px')
    from(win, { type: HEIGHT_MSG, h: 200.2 })
    expect(f.style.height).toBe('203px')
    from(win, { type: HEIGHT_MSG, h: 99999 })
    expect(f.style.height).toBe('720px')
  })

  it('html：超时未握手 → 回退为源码', async () => {
    vi.useFakeTimers()
    try {
      md(`${F}html\n<b>x</b>\n${F}`)
      expect(document.querySelector('iframe')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(READY_TIMEOUT_MS + 10)
      })
      expect(document.querySelector('iframe')).toBeNull()
      expect(document.querySelector('[data-slot="rich-fallback"]')?.textContent).toContain('沙箱页不可用')
    } finally {
      vi.useRealTimers()
    }
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
    // 高度回报必须能「缩」：documentElement.scrollHeight 不会小于 iframe 自身当前高度，只靠它会永远留一块空白（登录后真实页面里发现的）
    expect(r.doc).toContain('b.offsetHeight')
  })
  it('空 / 过大 → 失败', () => {
    expect(buildSandboxDoc('  ').ok).toBe(false)
    expect(buildSandboxDoc('x'.repeat(HTML_MAX + 1)).ok).toBe(false)
  })
})
