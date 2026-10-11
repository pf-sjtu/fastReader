import { describe, it, expect } from 'vitest'
import { sanitizeBookHtml } from '../src/utils/sanitizeHtml'

function parse(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = sanitizeBookHtml(html)
  return div
}

describe('sanitizeBookHtml', () => {
  it('空输入返回空串', () => {
    expect(sanitizeBookHtml('')).toBe('')
  })

  it('移除 img onerror', () => {
    const el = parse('<img src="x.png" onerror="alert(1)">')
    const img = el.querySelector('img')!
    expect(img.getAttribute('src')).toBe('x.png')
    expect(img.hasAttribute('onerror')).toBe(false)
  })

  it('移除 script 标签及其内容', () => {
    const out = sanitizeBookHtml('<p>a</p><script>alert(1)</script>')
    expect(out).not.toMatch(/script/i)
    expect(out).not.toContain('alert')
    expect(out).toContain('<p>a</p>')
  })

  it('移除 javascript: href', () => {
    const a = parse('<a href="javascript:alert(1)">x</a>').querySelector('a')!
    expect(a.getAttribute('href')).toBeNull()
    expect(a.textContent).toBe('x')
  })

  it('移除 iframe / object / embed / form / base / meta / link', () => {
    const out = sanitizeBookHtml(
      '<iframe src="https://evil.com"></iframe><object data="x"></object><embed src="x">' +
      '<form action="https://evil.com"><input></form><base href="https://evil.com/">' +
      '<meta http-equiv="refresh" content="0;url=https://evil.com"><link rel="stylesheet" href="https://evil.com/a.css">'
    )
    expect(out).not.toMatch(/<(iframe|object|embed|form|base|meta|link)\b/i)
  })

  it('移除 svg onload', () => {
    const out = sanitizeBookHtml('<svg onload="alert(1)"><circle r="1"></circle></svg>')
    expect(out).not.toMatch(/onload/i)
    expect(out).not.toContain('alert')
  })

  it('保留 epubjs 生成的 blob: 图片地址', () => {
    const img = parse('<img src="blob:https://fast-read.pages.dev/1f2e">').querySelector('img')!
    expect(img.getAttribute('src')).toBe('blob:https://fast-read.pages.dev/1f2e')
  })

  it('移除 data-* 属性', () => {
    expect(sanitizeBookHtml('<p data-x="1">a</p>')).toBe('<p>a</p>')
  })

  it('保留正常段落、图片、class 与内联样式', () => {
    const el = parse(
      '<h2 class="chapter-title">第一章</h2><p class="indent" style="text-indent:2em">正文<em>强调</em></p>' +
      '<img src="../images/a.png" alt="图"><img class="d" src="data:image/png;base64,iVBORw0KGgo=">' +
      '<a href="https://example.com/">链接</a>'
    )
    expect(el.querySelector('h2.chapter-title')?.textContent).toBe('第一章')
    const p = el.querySelector('p.indent')!
    expect(p.getAttribute('style')).toContain('text-indent')
    expect(p.querySelector('em')?.textContent).toBe('强调')
    expect(el.querySelector('img')?.getAttribute('src')).toBe('../images/a.png')
    expect(el.querySelector('img.d')?.getAttribute('src')).toMatch(/^data:image\/png/)
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('图')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
  })
})
