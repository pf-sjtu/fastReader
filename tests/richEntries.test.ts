/**
 * 渲染入口守卫：凡是把总结 / 关联 / 综述渲染成 Markdown 的地方都必须经 richMarkdownComponents，
 * 否则这些页面里的 mermaid / genui / html 块会被当成普通代码块，用户看到的是一坨源码。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(__dirname, '..', 'src')
// 例外必须写理由
const EXEMPT: Record<string, string> = {
  'src/components/study/AskAnswer.tsx': '问书的回答是即时对话内容，不是总结；模型被要求不输出富内容块',
}

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) files(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('富内容块渲染入口', () => {
  it('每个 <ReactMarkdown 都带 richMarkdownComponents（或登记例外）', () => {
    const offenders: string[] = []
    for (const f of files(SRC)) {
      const text = readFileSync(f, 'utf8')
      const rel = relative(join(__dirname, '..'), f).split(sep).join('/')
      // 每个 <ReactMarkdown ...> 开标签（到第一个 > 为止，容忍属性里的箭头函数 =>）
      for (const m of text.matchAll(/<ReactMarkdown\b([\s\S]*?)>(?=\s*[\n{<]|$)/g)) {
        if (!m[1].includes('richMarkdownComponents') && !EXEMPT[rel]) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
