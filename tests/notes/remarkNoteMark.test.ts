import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkNoteMark } from '@/notes/remarkNoteMark'
import type { Note } from '@/notes/notes'

const NOW = 1_700_000_000_000

function note(input: Partial<Note> & { quote: string }): Note {
  return {
    id: 'n1',
    chapterId: 'c1',
    chapterIndex: 0,
    chapterTitle: '第一章',
    quote: input.quote,
    prefix: input.prefix ?? '',
    suffix: input.suffix ?? '',
    comment: input.comment ?? '',
    color: input.color ?? 1,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
    ...(input.deleted ? { deleted: true } : {}),
    ...(input.id ? { id: input.id } : {}),
  }
}

const render = (md: string, notes: Note[]): string =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [[remarkGfm], [remarkNoteMark, { notes }]] },
      md
    )
  )

describe('remarkNoteMark', () => {
  it('把划线片段包成带 id 与颜色的 mark', () => {
    const html = render('前面有一句划线文字，后面还有。', [note({ quote: '划线文字', color: 2 })])
    expect(html).toContain('<mark class="note-mark" data-note-id="n1" data-color="2">划线文字</mark>')
    // 前后文原样保留
    expect(html).toContain('前面有一句')
    expect(html).toContain('，后面还有。')
  })

  it('跨内联格式也标得上：逐段包成同一 id 的多个 mark，文字不丢', () => {
    const html = render('这是**关键结论**，务必记住。', [note({ quote: '关键结论，务必记住' })])
    expect(html).toContain('data-note-id="n1"')
    expect(html).toContain('关键结论')
    expect(html).toContain('务必记住')
    expect(html).toContain('这是')
  })

  it('忽略空白与标点后仍能找到（tolerant）', () => {
    const html = render('他说：“先读完，再动手。”', [note({ quote: '先读完再动手' })])
    expect(html).toContain('class="note-mark"')
    expect(html).toContain('data-note-id="n1"')
  })

  it('原文被改写过也能模糊定位（fuzzy）', () => {
    const html = render('他坚持认为这是公司最关键的转折点，后来也被证明如此。', [
      note({ quote: '这是公司最关键的转折点' }),
    ])
    expect(html).toContain('class="note-mark"')
  })

  it('引文彻底消失时不标注', () => {
    const html = render('完全无关的一段话。', [note({ quote: '这句话不存在' })])
    expect(html).not.toContain('note-mark')
  })

  it('代码块与行内代码不碰', () => {
    const md = ['```', '划线文字', '```', '', '这里是 `划线文字` 行内代码。', '', '正文里也有划线文字。'].join('\n')
    const html = render(md, [note({ quote: '划线文字' })])
    // 只应命中正文那一处：mark 只出现一次
    expect(html.match(/class="note-mark"/g)?.length).toBe(1)
    expect(html).toContain('<code>划线文字</code>')
  })

  it('同一段里有多个候选时只标第一处', () => {
    const html = render('划线文字出现两次，划线文字又出现一次。', [note({ quote: '划线文字' })])
    expect(html.match(/class="note-mark"/g)?.length).toBe(1)
  })

  it('批注写进 title，没批注就不带 title', () => {
    const withComment = render('一句划线文字。', [note({ quote: '划线文字', comment: '这里的论证很关键' })])
    expect(withComment).toContain('title="这里的论证很关键"')
    const plain = render('一句划线文字。', [note({ quote: '划线文字' })])
    expect(plain).not.toContain('title=')
  })

  it('两条笔记各标各自的片段', () => {
    const md = '第一处重点在这，第二处重点在那。'
    const html = render(md, [
      note({ id: 'a', quote: '第一处重点' }),
      note({ id: 'b', quote: '第二处重点', color: 3 }),
    ])
    expect(html).toContain('data-note-id="a"')
    expect(html).toContain('data-note-id="b"')
    expect(html).toContain('data-color="3"')
  })

  it('墓碑笔记不标注', () => {
    const html = render('一句划线文字。', [note({ quote: '划线文字', deleted: true })])
    expect(html).not.toContain('note-mark')
  })

  it('两条笔记的引文重叠时都标上（嵌套）', () => {
    const md = '他坚持认为这是公司最关键的转折点。'
    const html = render(md, [
      note({ id: 'long', quote: '这是公司最关键的转折点' }),
      note({ id: 'short', quote: '最关键的转折点', color: 4 }),
    ])
    expect(html).toContain('data-note-id="long"')
    expect(html).toContain('data-note-id="short"')
    expect(html).toContain('data-color="4"')
    // 文字本身一处不能少、也不能重复
    expect(html.replace(/<[^>]+>/g, '')).toBe('他坚持认为这是公司最关键的转折点。')
  })

  it('笔记为空数组直接原样渲染', () => {
    const html = render('一句划线文字。', [])
    expect(html).toContain('一句划线文字。')
    expect(html).not.toContain('note-mark')
  })

  it('列表项里的引文也能标上', () => {
    const md = ['- 第一条：先看目录', '- 第二条：划线文字在列表里', '- 第三条'].join('\n')
    const html = render(md, [note({ quote: '划线文字在列表里' })])
    expect(html).toContain('data-note-id="n1"')
    expect(html).toContain('<li>')
  })
})
