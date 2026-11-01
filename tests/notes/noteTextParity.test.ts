/**
 * 「页签说已定位」与「正文真的画出高亮」必须等价。
 *
 * 独立审查（8.5，review-notes-pack）实测出三条口径差：缩进代码块、围栏外原始 HTML（`<div>`、
 * `<!-- -->`）在页签判「已定位」而正文一处都画不出来。根因是两侧各自维护「哪些块不参与定位」
 * 的判定；现在两侧共用 `src/notes/noteText.ts`。
 *
 * 这里用一个参数化断言把它钉住：对每种 markdown 形态，正文里的 `mark` 数 > 0
 * **当且仅当** 页签口径（`createNoteResolver(noteSearchText(md))`）判成找得到。
 * 单侧断言各自看都通，只有对照才拦得住这类分歧，所以本文件必须与渲染链一致地跑一遍。
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'
import { remarkNoteMark } from '@/notes/remarkNoteMark'
import { createNoteResolver } from '@/notes/anchor'
import { noteSearchText } from '@/notes/noteText'
import type { Note } from '@/notes/notes'

const NOW = 1_700_000_000_000

function note(quote: string): Note {
  return {
    id: 'n1',
    chapterId: 'c1',
    chapterIndex: 0,
    chapterTitle: '第一章',
    quote,
    prefix: '',
    suffix: '',
    comment: '',
    color: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** 与 `MarkdownCard` 同一条插件链（顺序也一致），笔记插件接在最后 */
function renderBody(md: string, quote: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [
          [remarkGfm],
          [remarkCjkFriendly],
          [remarkTailQuestions],
          [remarkNoteMark, { notes: [note(quote)] }],
        ],
      },
      md
    )
  )
}

function bodyMarkCount(md: string, quote: string): number {
  return renderBody(md, quote).split('data-note-id="n1"').length - 1
}

function panelLocated(md: string, quote: string): boolean {
  return createNoteResolver(noteSearchText(md)).resolve({ quote }) !== null
}

interface Case {
  name: string
  md: string
  quote: string
  /** 期望结果（两侧必须一致）：正文画不画得出高亮 */
  expected: boolean
}

const CASES: Case[] = [
  { name: '普通段落', md: '第一段。\n\n第二段：编号10。', quote: '编号10', expected: true },
  { name: '围栏代码块', md: '正文一。\n\n```js\nconst hot = true\n```\n\n正文二。', quote: 'const hot = true', expected: false },
  { name: '围栏代码块（mermaid 富块）', md: '正文一。\n\n```mermaid\ngraph TD; A-->B\n```', quote: 'graph TD; A-->B', expected: false },
  { name: '缩进代码块', md: '正文一。\n\n    const secret = 42\n\n正文二。', quote: 'const secret = 42', expected: false },
  { name: '围栏外原始 HTML 块', md: '正文一。\n\n<div class="x">隐藏内容</div>\n\n正文二。', quote: '隐藏内容', expected: false },
  { name: '围栏外 HTML 注释', md: '正文一。\n\n<!-- 保密说明 -->\n\n正文二。', quote: '保密说明', expected: false },
  { name: '行内 HTML 标签之间的文字', md: '正文一<span>行内标签</span>正文二。', quote: '行内标签', expected: true },
  { name: '行内代码', md: '用 `map` 记下这件事，很有用。', quote: '用 map 记下这件事', expected: true },
  { name: '表格单元格', md: '| 列 | 值 |\n| --- | --- |\n| A | 表格文字 |', quote: '表格文字', expected: true },
  { name: '列表项', md: '- 第一项\n- 第二项', quote: '第二项', expected: true },
  { name: '引用块', md: '> 引用里的一句话。', quote: '引用里的一句话', expected: true },
  { name: '未闭合围栏（输出被截断）', md: '正文一。\n\n```genui\n{"type":"card"', quote: '正文一。', expected: true },
  { name: '跨段落引文（只画起点那一块）', md: '站了很久。\n\n直到云海翻涌。', quote: '站了很久。 直到云海翻涌。', expected: true },
  { name: '引文只在围栏后的截断区里', md: '正文一。\n\n```genui\n{"type":"card"', quote: '"card"', expected: false },
]

describe('页签判定 ⟺ 正文高亮（同一口径）', () => {
  for (const c of CASES) {
    it(`${c.name}：两侧一致（${c.expected ? '定位得到' : '定位不到'}）`, () => {
      const marks = bodyMarkCount(c.md, c.quote)
      const panel = panelLocated(c.md, c.quote)
      // 先钉期望值，避免「两侧一起错」也变绿
      expect(marks > 0, `正文 mark 数=${marks}`).toBe(c.expected)
      expect(panel, '页签口径').toBe(c.expected)
      expect(marks > 0, '两侧必须等价').toBe(panel)
    })
  }

  it('同一章里多条笔记叠加后仍然等价（后画的不会改写前面的判定）', () => {
    const md = '第一段：编号1。\n\n```js\nconst hot = true\n```\n\n第三段：编号10。'
    for (const quote of ['编号1', '编号10', 'const hot = true']) {
      expect(panelLocated(md, quote)).toBe(bodyMarkCount(md, quote) > 0)
    }
  })
})
