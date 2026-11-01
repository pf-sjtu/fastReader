import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PACK_LABELS,
  NOTE_PALETTE,
  buildStudyPackHtml,
  escapeHtml,
  formatLocalTime,
  type PackLabels,
  type PackData,
} from '@/study/pack/buildPack'
import { collectPackData } from '@/study/pack/collect'
import { captureDiagramImages, type SvgRenderFn } from '@/study/pack/captureImages'

const XSS = '<script>alert(1)</script>'

/** 完整样例：每个可选块都有内容，便于逐块断言 */
const pack = (patch: Partial<PackData> = {}): PackData => ({
  title: '穷查理宝典',
  author: '查理·芒格',
  generatedAt: new Date('2026-03-04T05:06:00').getTime(),
  chapters: [
    { index: 0, title: '第一章 多元思维模型', summary: '## 要点\n\n- 模型要跨学科\n- 别做铁锤人\n\n正文段落。' },
    { index: 1, title: '第二章 逆向思考', summary: '反过来想，总是反过来想。' },
  ],
  connections: '多元思维模型与逆向思考互为表里。',
  overallSummary: '全书围绕「理性」展开。',
  notes: [
    { chapterTitle: '第二章 逆向思考', quote: '反过来想', comment: '第二章批注', color: 2 },
    { chapterTitle: '第一章 多元思维模型', quote: '铁锤人', comment: '第一章批注', color: 1 },
  ],
  quiz: [
    { question: '芒格主张什么样的思维？', options: ['单一学科', '多元跨学科'], answerIndex: 1, explanation: '要跨学科', chosen: 0 },
  ],
  people: [{ name: '查理·芒格', color: '#b5321f', desc: '投资人' }],
  images: [{ title: '人物关系图', dataUri: 'data:image/png;base64,AAAA' }],
  ...patch,
})

/** 取出某个 section 的 HTML 片段（从它的 id 到下一个 section 之前） */
const sectionOf = (html: string, id: string): string => {
  const start = html.indexOf(`id="${id}"`)
  if (start < 0) return ''
  const next = html.indexOf('<section', start)
  return html.slice(start, next < 0 ? undefined : next)
}

describe('escapeHtml', () => {
  it('转义全部五个字符，且 & 只转义一次', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    )
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})

describe('formatLocalTime', () => {
  it('输出 YYYY-MM-DD HH:mm 的本地时间，非法时间返回空串', () => {
    expect(formatLocalTime(new Date('2026-03-04T05:06:00').getTime())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatLocalTime(Number.NaN)).toBe('')
  })
})

describe('buildStudyPackHtml', () => {
  it('是完整 HTML 文档，含书名、作者与生成时间', () => {
    const html = buildStudyPackHtml(pack())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('</html>')
    expect(html).toContain('穷查理宝典')
    expect(html).toContain('查理·芒格')
    expect(html).toContain(`生成时间：${formatLocalTime(pack().generatedAt)}`)
  })

  it('空数据也不崩，仍是完整文档', () => {
    const html = buildStudyPackHtml({
      title: '',
      generatedAt: Date.now(),
      chapters: [],
      notes: [],
      quiz: null,
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('未命名')
  })

  it('章节总结 / 笔记 / 题目里的脚本都被转义，输出不含任何可执行的 <script>', () => {
    const html = buildStudyPackHtml(
      pack({
        title: XSS,
        chapters: [{ index: 0, title: XSS, summary: `正文 ${XSS} 结束` }],
        notes: [{ chapterTitle: XSS, quote: XSS, comment: XSS, color: 1 }],
        quiz: [{ question: XSS, options: [XSS], answerIndex: 0, explanation: XSS, chosen: 0 }],
        people: [{ name: XSS, color: '#000', desc: XSS }],
        images: [{ title: XSS, dataUri: 'data:image/png;base64,AAAA' }],
        connections: XSS,
        overallSummary: XSS,
      })
    )
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

    // 更强的证据：解析成 DOM 后没有任何 script 元素、也没有任何内联事件属性；
    // 而恶意文本应当以纯文本（textContent）形式留在页面里 —— 也就是「显示了但不会执行」
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    const withHandlers = [...doc.querySelectorAll('*')].filter((el) =>
      [...el.attributes].some((attr) => attr.name.toLowerCase().startsWith('on'))
    )
    expect(withHandlers.map((el) => el.tagName)).toEqual([])
    expect(doc.body.textContent).toContain('<script>alert(1)</script>')
  })

  it('& 被转义为实体，不会留在正文里当成实体引入点', () => {
    const html = buildStudyPackHtml(
      pack({
        chapters: [{ index: 0, title: 'A & B', summary: '甲 & 乙' }],
        notes: [],
        quiz: null,
        connections: undefined,
        overallSummary: undefined,
      })
    )
    expect(html).toContain('A &amp; B')
    expect(html).toContain('甲 &amp; 乙')
    expect(html).not.toMatch(/[^&]&[^a-z#]/i)
  })

  it('人物志颜色进的是属性值：引号被转义，构造不出新属性', () => {
    const html = buildStudyPackHtml(
      pack({ people: [{ name: '某人', color: 'red" onmouseover="alert(1)' }] })
    )
    expect(html).not.toContain('onmouseover="alert(1)')
    expect(html).toContain('background:red&quot; onmouseover=&quot;alert(1)')
  })

  it('完全自包含：不含任何外部 URL、脚本或样式表引用', () => {
    const html = buildStudyPackHtml(pack())
    expect(html).not.toContain('src="http')
    expect(html).not.toContain('href="http')
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<link')
    expect(html).toContain('<style>')
  })

  it('图片只接受 data:image 内联 URI，外部地址一律丢弃', () => {
    const html = buildStudyPackHtml(
      pack({
        images: [
          { title: '内联图', dataUri: 'data:image/png;base64,AAAA' },
          { title: '外链图', dataUri: 'https://example.com/a.png' },
        ],
      })
    )
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('example.com')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('章节按 index 排序，而不是按数组顺序', () => {
    const html = buildStudyPackHtml(
      pack({
        chapters: [
          { index: 2, title: '第三章 结论', summary: 'c' },
          { index: 0, title: '第一章 开篇', summary: 'a' },
          { index: 1, title: '第二章 展开', summary: 'b' },
        ],
      })
    )
    const first = html.indexOf('第一章 开篇')
    const second = html.indexOf('第二章 展开')
    const third = html.indexOf('第三章 结论')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second)
    expect(second).toBeLessThan(third)
  })

  it('章节总结做最小 Markdown 处理：标题与无序列表', () => {
    const html = buildStudyPackHtml(pack())
    expect(html).toContain('<h4>要点</h4>')
    expect(html).toContain('<li>模型要跨学科</li>')
    expect(html).toContain('<p>正文段落。</p>')
  })

  it('笔记按章节分组：章节顺序在前，孤儿笔记仍保留', () => {
    const html = buildStudyPackHtml(
      pack({
        notes: [
          { chapterTitle: '第二章 逆向思考', quote: '反过来想', comment: '第二章批注', color: 2 },
          { chapterTitle: '第一章 多元思维模型', quote: '铁锤人', comment: '第一章批注', color: 1 },
          { chapterTitle: '已被改名或已删除的章节', quote: '游离片段', comment: '孤儿批注', color: 3 },
        ],
      })
    )
    const notes = sectionOf(html, 'notes')
    expect(notes).toContain('第一章批注')
    expect(notes).toContain('第二章批注')
    expect(notes).toContain('孤儿批注')
    // 分组按章节顺序，且组标题就是章节标题
    expect(notes.indexOf('第一章 多元思维模型')).toBeLessThan(notes.indexOf('第二章 逆向思考'))
    expect(notes.indexOf('第一章批注')).toBeLessThan(notes.indexOf('第二章批注'))
    // 对不上章节的笔记补在最后，不丢
    expect(notes.indexOf('第二章批注')).toBeLessThan(notes.indexOf('孤儿批注'))
  })

  it('笔记四色竖条使用调色板，且可被调用方覆盖', () => {
    const notes = (color: 1 | 2 | 3 | 4): PackData['notes'] => [
      { chapterTitle: '第一章 多元思维模型', quote: 'q', comment: 'c', color },
    ]
    for (const color of [1, 2, 3, 4] as const) {
      const html = buildStudyPackHtml(pack({ notes: notes(color) }))
      expect(html).toContain(`border-left-color:${NOTE_PALETTE[color]}`)
    }
    const custom = buildStudyPackHtml(
      pack({
        notes: [
          { chapterTitle: '第一章 多元思维模型', quote: 'q1', comment: 'c1', color: 1 },
          { chapterTitle: '第一章 多元思维模型', quote: 'q4', comment: 'c4', color: 4 },
        ],
      }),
      { noteColors: { 4: '#123456' } }
    )
    expect(custom).toContain('border-left-color:#123456')
    // 只覆盖一色，其余保持默认
    expect(custom).toContain(`border-left-color:${NOTE_PALETTE[1]}`)
  })

  it('自测题含题面、选项、正确答案高亮、已选标记与解析', () => {
    const html = buildStudyPackHtml(pack())
    const quiz = sectionOf(html, 'quiz')
    expect(quiz).toContain('第 1 题')
    expect(quiz).toContain('芒格主张什么样的思维？')
    expect(quiz).toContain('多元跨学科')
    expect(quiz).toMatch(/class="opt is-answer[^"]*"[\s\S]*?正确答案/)
    expect(quiz).toMatch(/class="opt[^"]*is-chosen[^"]*"[\s\S]*?你的选择/)
    expect(quiz).toContain('解析')
    expect(quiz).toContain('要跨学科')
    // 正确项与已选项是不同选项（chosen=0 / answerIndex=1）
    expect(quiz.indexOf('正确答案')).toBeGreaterThan(quiz.indexOf('你的选择'))
  })

  it('未作答的题不显示「你的选择」', () => {
    const html = buildStudyPackHtml(
      pack({ quiz: [{ question: 'q', options: ['a', 'b'], answerIndex: 0 }] })
    )
    expect(html).toContain('正确答案')
    expect(html).not.toContain('你的选择')
  })

  it('人物志颜色被内联；预览区把图片内嵌为 data URI', () => {
    const html = buildStudyPackHtml(pack())
    expect(sectionOf(html, 'people')).toContain('background:#b5321f')
    expect(sectionOf(html, 'images')).toContain('src="data:image/png;base64,AAAA"')
    expect(sectionOf(html, 'images')).toContain('人物关系图')
  })

  it('界面文案可以整包换成其它语言（默认中文）', () => {
    const english: PackLabels = {
      ...DEFAULT_PACK_LABELS,
      docTitleSuffix: 'Study Pack',
      toc: 'Contents',
      chapters: 'Chapters',
      notes: 'Notes',
      quiz: 'Quiz',
      connections: 'Connections',
      overallSummary: 'Overall summary',
      people: 'People',
      images: 'Diagrams',
      emptyChapter: '(no summary yet)',
      author: 'Author',
      generatedAt: 'Generated',
      correctAnswer: 'Answer',
      yourChoice: 'Your pick',
      explanation: 'Why',
      questionNo: (n) => `Q${n}`,
      countOf: (unit, n) => `${n} ${unit}`,
    }
    const html = buildStudyPackHtml(pack(), { labels: english })
    expect(html).toContain('<title>穷查理宝典 · Study Pack</title>')
    expect(html).toContain('2 Chapters')
    expect(html).toContain('2 Notes')
    expect(sectionOf(html, 'quiz')).toContain('Q1')
    expect(sectionOf(html, 'quiz')).toContain('Your pick')
    expect(sectionOf(html, 'quiz')).toContain('Answer')
    expect(sectionOf(html, 'quiz')).toContain('Why')
    expect(html).not.toContain('正确答案')
  })

  it('只覆盖一两条文案时，其余保持默认', () => {
    const html = buildStudyPackHtml(pack(), { labels: { quiz: 'Self-test' } })
    expect(html).toContain('<h2>Self-test</h2>')
    expect(html).toContain(`<h2>${DEFAULT_PACK_LABELS.notes}</h2>`)
    // 未覆盖的题号格式仍是默认的「第 1 题」
    expect(html).toContain('第 1 题')
    expect(html).toContain(DEFAULT_PACK_LABELS.correctAnswer)
  })

  it('章节标题属用户数据，不随文案覆盖而改变', () => {
    const html = buildStudyPackHtml(pack(), { labels: { chapters: 'Chapters' } })
    expect(html).toContain('第一章 多元思维模型')
    expect(html).toContain('第二章 逆向思考')
  })

  it('打印友好：含 @media print，去掉阴影并避免跨页断裂', () => {
    const html = buildStudyPackHtml(pack())
    expect(html).toContain('@media print')
    expect(html).toContain('break-inside: avoid')
    expect(html).toContain('print-color-adjust: exact')
  })

  it('目录只含内部锚点', () => {
    const html = buildStudyPackHtml(pack())
    expect(html).toContain('href="#ch-0"')
    expect(html).toContain('href="#ch-1"')
  })
})

describe('collectPackData', () => {
  const input = {
    book: {
      title: ' 穷查理宝典 ',
      author: '查理·芒格',
      chapters: [
        { title: '第一章', summary: ' 总结一 ' },
        { title: '第二章' },
      ],
    },
    connections: ' 关联 ',
    overallSummary: '',
    notes: [
      { chapterTitle: ' 第一章 ', quote: ' 片段 ', comment: ' 批注 ', color: 2 as const },
      { chapterTitle: '第二章', quote: '   ', comment: '空的原文片段，丢弃', color: 1 as const },
    ],
    study: {
      quiz: {
        questions: [
          { question: '第一题', options: ['a', 'b'], answerIndex: 1 },
          { question: '第二题', options: ['a', 'b'], answerIndex: 1, explanation: ' 因为 ' },
        ],
      },
      answers: { q1: { correct: false, chosen: 0 } },
    },
    now: 1_700_000_000_000,
  }

  it('章节按数组顺序重编号，summary 缺省为空串', () => {
    const data = collectPackData(input)
    expect(data.chapters).toEqual([
      { index: 0, title: '第一章', summary: '总结一' },
      { index: 1, title: '第二章', summary: '' },
    ])
  })

  it('搬运书名 / 作者 / 时间，并 trim 可选文本', () => {
    const data = collectPackData(input)
    expect(data.title).toBe('穷查理宝典')
    expect(data.author).toBe('查理·芒格')
    expect(data.connections).toBe('关联')
    expect(data.generatedAt).toBe(1_700_000_000_000)
    // overallSummary 是空串：不带这个键，而不是带一个空串
    expect('overallSummary' in data).toBe(false)
  })

  it('丢弃空原文片段的笔记，其余 trim 后保留', () => {
    const data = collectPackData(input)
    expect(data.notes).toEqual([{ chapterTitle: '第一章', quote: '片段', comment: '批注', color: 2 }])
  })

  it('非法颜色收敛到 1', () => {
    const data = collectPackData({
      ...input,
      notes: [{ chapterTitle: 'c', quote: 'q', comment: 'x', color: 9 as unknown as 1 }],
    })
    expect(data.notes[0].color).toBe(1)
  })

  it('作答按题目 id（q1、q2…）贴回对应题目', () => {
    const data = collectPackData(input)
    expect(data.quiz).toEqual([
      { question: '第一题', options: ['a', 'b'], answerIndex: 1, chosen: 0 },
      { question: '第二题', options: ['a', 'b'], answerIndex: 1, explanation: '因为' },
    ])
  })

  it('没有自测时 quiz 为 null；没有人物与图片时相应键不出现', () => {
    const data = collectPackData({ ...input, study: null })
    expect(data.quiz).toBeNull()
    expect('people' in data).toBe(false)
    expect('images' in data).toBe(false)
    expect('author' in collectPackData({ book: { title: 't', chapters: [] }, notes: [] })).toBe(false)
  })

  it('产出的 PackData 能直接建包', () => {
    const html = buildStudyPackHtml(collectPackData(input))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('第一题')
    expect(html).toContain('你的选择')
  })
})

describe('captureDiagramImages', () => {
  const okRenderer = (svg: string): SvgRenderFn => async () => ({ ok: true, svg })
  const failRenderer = (error: string): SvgRenderFn => async () => ({ ok: false, error })

  it('把 SVG 包成 data URI 图片', async () => {
    const { images, failed } = await captureDiagramImages(
      [{ title: '关系图', code: 'graph TD; A-->B' }],
      okRenderer('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    )
    expect(failed).toEqual([])
    expect(images).toHaveLength(1)
    expect(images[0].title).toBe('关系图')
    expect(images[0].dataUri.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('渲染失败 / 空图只跳过那一张，不抛异常也不影响其它图', async () => {
    const sources = [
      { title: '空图', code: '   ' },
      { title: '坏图', code: 'graph TD; bad' },
      { title: '好图', code: 'graph TD; A-->B' },
    ]
    const render: SvgRenderFn = async (code) => {
      if (code.includes('bad')) return { ok: false, error: '语法错' }
      return { ok: true, svg: '<svg/>' }
    }
    const { images, failed } = await captureDiagramImages(sources, render)
    expect(images.map((i) => i.title)).toEqual(['好图'])
    expect(failed).toEqual([
      { title: '空图', error: '图为空' },
      { title: '坏图', error: '语法错' },
    ])
  })

  it('渲染函数抛异常时也收进 failed', async () => {
    const { images, failed } = await captureDiagramImages(
      [{ title: '炸了', code: 'graph TD' }],
      async () => {
        throw new Error('渲染超时')
      }
    )
    expect(images).toEqual([])
    expect(failed).toEqual([{ title: '炸了', error: '渲染超时' }])
  })

  it('空代码或渲染失败时用纯函数渲染器也能收进 failed', async () => {
    const { failed } = await captureDiagramImages([{ title: '空', code: '' }], failRenderer('不该被调用'))
    expect(failed).toEqual([{ title: '空', error: '图为空' }])
  })

  it('截到的图能进学习包并保持离线自包含', async () => {
    const { images } = await captureDiagramImages(
      [{ title: '关系图', code: 'graph TD; A-->B' }],
      okRenderer('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    )
    const html = buildStudyPackHtml(
      pack({ images, people: undefined })
    )
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).not.toContain('src="http')
    expect(html).not.toContain('<script')
  })
})
