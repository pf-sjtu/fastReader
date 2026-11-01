import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkNoteMark } from '@/notes/remarkNoteMark'
import { createNoteResolver } from '@/notes/anchor'
import { noteSearchText } from '@/notes/noteText'
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

  it('代码块不碰；引文确实覆盖行内代码时，标在代码上（与笔记页签口径一致）', () => {
    const md = ['```', '围栏里的文字', '```', '', '这里是 `行内代码文字` 行内代码。'].join('\n')
    // 围栏块整块跳过：引文只出现在围栏里时一处都不标
    expect(render(md, [note({ quote: '围栏里的文字' })])).not.toContain('note-mark')
    // 行内代码的文字参与定位（笔记页签已经把它算作「找得到」），画的时候整段包住 code
    expect(render(md, [note({ quote: '行内代码文字' })])).toContain(
      '<mark class="note-mark" data-note-id="n1" data-color="1"><code>行内代码文字</code></mark>'
    )
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

  /*
   * 以下四条是独立审查（review-notes-pack）发现的行为错，逐条立回归：
   * 都是「测试全绿但划线画错/画不上/画很久」的典型，光靠既有的单块用例拦不住。
   */

  it('短引文在更早段落有近似文字时，仍要画在真正命中原句的那一段', () => {
    // 旧实现「撞上第一块就画」：第 1 段的「编号1」被模糊匹配吃掉，第 3 段真正的「编号10」反而没画
    const md = ['第1段：编号1。', '', '第2段：无关。', '', '第3段：编号10。'].join('\n')
    const html = render(md, [note({ quote: '编号10', prefix: '第3段：', suffix: '。' })])
    expect(html.match(/class="note-mark"/g)?.length).toBe(1)
    expect(html).toContain('第1段：编号1。')
    expect(html).toContain('第3段：<mark class="note-mark" data-note-id="n1" data-color="1">编号10</mark>')
  })

  it('跨段落划的引文至少画出能画的部分，界面不能出现「面板说已定位、正文一处都没有」', () => {
    // makeNote 会把选区里的换行折成一个空格，所以引文天生跨块
    const md = ['他在山脊上站了很久。', '', '直到云海翻涌。'].join('\n')
    const html = render(md, [
      note({ quote: '站了很久。 直到云海', prefix: '他在山脊上', suffix: '翻涌。' }),
    ])
    expect(html).toContain('class="note-mark"')
    expect(html.match(/class="note-mark"/g)?.length).toBe(1)
  })

  it('选区跨过行内代码时正文也标得上（审查发现的第二个「面板说已定位、正文 0 高亮」）', () => {
    // md 源码里的反引号在折叠比对时被当标点去掉，所以页签用 tolerant 命中；正文必须同样命中
    const html = render('用 `map` 记下这件事，很有用。', [note({ quote: '用 map 记下这件事' })])
    expect(html).toContain('class="note-mark"')
    expect(html.replace(/<[^>]+>/g, '')).toBe('用 map 记下这件事，很有用。')
  })

  it('跨列表项的引文只标一处，不做成多个同 id 的 mark', () => {
    const md = ['- 第一条：先看目录', '- 第二条：再读正文', '- 第三条'].join('\n')
    const html = render(md, [
      note({ quote: '先看目录 第二条：再读正文', prefix: '第一条：', suffix: '' }),
    ])
    expect(html.match(/class="note-mark"/g)?.length).toBe(1)
  })

  it('同一条笔记引文重叠时嵌套层数不再横向推开文字（mark 不带水平内边距）', () => {
    const md = '第1段：编号1。'
    const notes = Array.from({ length: 5 }, (_, i) =>
      note({ id: `n${i}`, quote: '编号1', color: 1 })
    )
    const html = render(md, notes)
    // 五条笔记重叠：都画上（嵌套 mark），文字本身仍只有一份
    expect(html.match(/class="note-mark"/g)?.length).toBe(5)
    expect(html.replace(/<[^>]+>/g, '')).toBe('第1段：编号1。')
  })

  it('围栏代码块里的引文：正文不标，且页签口径（noteSearchText）同样判成找不到', () => {
    // 审查发现：在渲染后的代码块里选中文字照样能建笔记，页签会报「还在」而正文一处都画不出来。
    // 两侧口径必须一致，所以页签改用 noteSearchText（围栏块不参与定位）来判。
    const md = ['正文一。', '', '```js', 'const hot = true', '```', '', '正文二。'].join('\n')
    const quote = 'const hot = true'
    const html = render(md, [note({ quote })])
    expect(html.match(/class="note-mark"/g)?.length ?? 0).toBe(0)
    const searchable = noteSearchText(md)
    expect(createNoteResolver(searchable).resolve({ quote })).toBeNull()
    // 正文里的普通文字两侧都认
    expect(createNoteResolver(searchable).resolve({ quote: '正文二。' })).not.toBeNull()
  })
})

describe('.note-mark 的样式契约', () => {
  // 重叠笔记是**嵌套**的 mark，每层各带 1px 水平内边距就会把文字横向推开（审查实测约 10px）。
  // 只断言 textContent 拦不住这个回归，所以这里直接读 index.css。
  const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

  it('不带水平内边距（嵌套时不推挤文字）', () => {
    const start = CSS.indexOf('.note-mark')
    expect(start).toBeGreaterThan(-1)
    const block = CSS.slice(start, CSS.indexOf('}', start))
    // padding / padding-inline / padding-left|right 都不许出现
    expect(block).not.toMatch(/padding(-inline|-left|-right)?\s*:/)
    expect(block).toMatch(/background:/)
  })

  it('四个颜色槽位都映射到语义 token（与应用内笔记色一致）', () => {
    for (const tone of ['--info', '--success', '--warning']) {
      expect(CSS).toContain(`[data-color='${tone === '--info' ? 2 : tone === '--success' ? 3 : 4}']`)
    }
  })
})
