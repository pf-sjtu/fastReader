import { describe, it, expect } from 'vitest'
import { DEFAULT_PACK_LABELS, buildStudyPackHtml } from '@/study/pack'

const F = '```'
const sample = [
  '正文第一段。',
  '',
  `${F}genui`,
  JSON.stringify([
    { type: 'steps', title: '流程', items: [{ label: '甲', detail: '先做' }, { label: '乙' }] },
    { type: 'compare', columns: ['A', 'B'], rows: [{ label: '速度', cells: ['快', '慢'] }] },
    { type: 'callout', tone: 'warn', body: '<script>alert(1)</script>' },
    { type: 'quiz', question: '谁先到？', options: ['甲', '乙'], answer: 1, explain: '乙更快' },
  ]),
  F,
  '',
  `${F}mermaid`,
  'graph LR',
  'A-->B',
  F,
  '',
  `${F}html`,
  '<button onclick="x()">点我</button>',
  F,
  '',
  '收尾段。',
].join('\n')

const build = (summary: string) =>
  buildStudyPackHtml({
    title: '书',
    generatedAt: 0,
    chapters: [{ index: 0, title: '第一章', summary }],
    notes: [],
    quiz: null,
  })

describe('学习包：总结里的富内容块', () => {
  const html = build(sample)

  it('genui 渲染成静态组件，测验直接给出答案与解析', () => {
    expect(html).toContain('class="gu-steps"')
    expect(html).toContain('<td>快</td>')
    expect(html).toContain(DEFAULT_PACK_LABELS.correctAnswer)
    expect(html).toContain('乙更快')
  })

  it('块内文本照样转义，不产生可执行标签；源码围栏与 JSON 不外泄', () => {
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('"type":"steps"')
    expect(html).not.toContain('onclick')
  })

  it('mermaid 以源码呈现，html 换成「仅在线可用」，正文不丢', () => {
    expect(html).toContain(DEFAULT_PACK_LABELS.diagramBelow)
    expect(html).toContain('graph LR')
    expect(html).toContain('A--&gt;B')
    expect(html).toContain(DEFAULT_PACK_LABELS.interactiveOnline)
    expect(html).toContain('正文第一段')
    expect(html).toContain('收尾段')
    expect(html).not.toContain('RICHFRAG')
  })

  it('坏 genui → 说明占位；未闭合的尾块直接丢弃', () => {
    const bad = build(`前文\n\n${F}genui\n{坏的\n${F}\n\n${F}html\n<p>没闭合`)
    expect(bad).toContain(DEFAULT_PACK_LABELS.interactiveOnline)
    expect(bad).not.toContain('没闭合')
    expect(bad).not.toContain('RICHFRAG')
  })
})
