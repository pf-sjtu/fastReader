/**
 * 离线学习包接线层（`src/study/exportPack.ts`）的测试。
 *
 * 这里只测「接线」，不重复测 `src/study/pack/**` 的纯渲染（那是 `tests/study/pack.test.ts`）：
 * 笔记怎么归位、人物志怎么挑、mermaid 图从哪来、色值怎么解析、i18n 文案怎么落到包里。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookCharts } from '@/charts/types'
import type { Note } from '@/notes/notes'
import { DEFAULT_PACK_LABELS } from '@/study/pack'
import {
  buildPackHtml,
  mermaidSourcesOf,
  packLabels,
  packNotesOf,
  peopleOf,
  resolveCssColorVar,
  studyPackFileName,
  type PackChapterSource,
} from '@/study/exportPack'

const chapters: PackChapterSource[] = [
  { id: 'c1', title: '第一章 多元思维模型', summary: '正文一' },
  { id: 'c2', title: '第二章 逆向思考', summary: '正文二' },
]

const note = (patch: Partial<Note> = {}): Note => ({
  id: 'n1',
  chapterId: 'c2',
  chapterIndex: 1,
  chapterTitle: '第二章 逆向思考',
  quote: '反过来想',
  prefix: '总是',
  suffix: '，总是',
  comment: '',
  color: 1,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

describe('packNotesOf', () => {
  it('按章节 id 归位：笔记自己记的旧标题被换成当前标题', () => {
    const notes = packNotesOf([note({ chapterTitle: '旧的第二章' })], chapters)
    expect(notes).toEqual([
      { chapterTitle: '第二章 逆向思考', quote: '反过来想', comment: '', color: 1 },
    ])
  })

  it('章节被删掉 / 改得认不出来时退回笔记自己的标题，不丢', () => {
    const notes = packNotesOf(
      [note({ chapterId: 'c9', chapterIndex: 8, chapterTitle: '第九章 已经不在了' })],
      chapters
    )
    expect(notes[0].chapterTitle).toBe('第九章 已经不在了')
  })

  it('墓碑与空引文不导出，引文与批注去首尾空白', () => {
    const notes = packNotesOf(
      [
        note({ id: 'a', quote: '  反过来想  ', comment: '  批注  ', color: 3 }),
        note({ id: 'b', deleted: true }),
        note({ id: 'c', quote: '   ' }),
      ],
      chapters
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ quote: '反过来想', comment: '批注', color: 3 })
  })
})

const charts = (): BookCharts =>
  ({
    entityGraph: {
      nodes: [
        { id: 'p1', name: '查理·芒格', description: '投资人' },
        { id: 'o1', name: '哈佛法学院', type: '组织' },
      ],
      edges: [{ source: 'p1', target: 'o1', relation: '就读于' }],
    },
  }) as unknown as BookCharts

describe('peopleOf', () => {
  it('只收人物（圆形）节点，颜色经回调解析，描述来自图谱', () => {
    const people = peopleOf(charts(), () => '#b5321f')
    expect(people).toEqual([{ name: '查理·芒格', color: '#b5321f', desc: '投资人' }])
  })

  it('没有图谱时返回空数组（不能把 null 传给 getEntityGraph）', () => {
    expect(peopleOf(null, () => '#000')).toEqual([])
    expect(peopleOf(undefined, () => '#000')).toEqual([])
  })

  it('图谱里没写描述时用时间线实体的描述补', () => {
    const withTimeline = {
      entityGraph: { nodes: [{ id: 'p1', name: '查理·芒格' }], edges: [] },
      entityTimeline: {
        entities: [{ id: 'p1', name: '查理·芒格', description: '来自时间线' }],
        events: [],
      },
    } as unknown as BookCharts
    expect(peopleOf(withTimeline, () => '#000')[0].desc).toBe('来自时间线')
  })
})

describe('mermaidSourcesOf', () => {
  it('取每章正文里的 mermaid 图块，图题用章节标题', () => {
    const sources = mermaidSourcesOf([
      { title: '第一章', summary: '前言\n\n```mermaid\ngraph TD\nA-->B\n```\n\n后记' },
      { title: '', summary: '```mermaid\nflowchart LR\nX-->Y\n```' },
    ])
    expect(sources).toEqual([
      { title: '第一章', code: 'graph TD\nA-->B' },
      { title: '#2', code: 'flowchart LR\nX-->Y' },
    ])
  })

  it('忽略截断的坏块、空代码与别的富内容块', () => {
    const sources = mermaidSourcesOf([
      {
        title: '第一章',
        summary: '```genui\n{"a":1}\n```\n\n```html\n<b>x</b>\n```\n\n```mermaid\n   \n```',
      },
      // 没闭合的围栏：源码必然被截断，导出不完整的图没有意义
      { title: '第二章', summary: '```mermaid\ngraph TD\nA-->B' },
    ])
    expect(sources).toEqual([])
  })
})

describe('resolveCssColorVar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('解析 var(--x) 为页面上的真实颜色', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--entity-3' ? 'oklch(0.5 0.1 30)' : ''),
    } as unknown as CSSStyleDeclaration)
    expect(resolveCssColorVar('var(--entity-3)')).toBe('oklch(0.5 0.1 30)')
  })

  it('不是变量写法 / 变量没定义时退回 currentColor，绝不返回空串', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration)
    expect(resolveCssColorVar('#b5321f')).toBe('currentColor')
    expect(resolveCssColorVar('var(--entity-99)')).toBe('currentColor')
    expect(resolveCssColorVar('var(--entity-1, red)')).toBe('currentColor')
  })
})

describe('packLabels', () => {
  it('词典缺键时退回默认中文文案', () => {
    const labels = packLabels((_key, options) => String(options?.defaultValue))
    // 两个函数键按行为比对：对象深比较看的是函数引用
    expect({ ...labels, questionNo: null, countOf: null }).toEqual({
      ...DEFAULT_PACK_LABELS,
      questionNo: null,
      countOf: null,
    })
    expect(labels.questionNo(3)).toBe(DEFAULT_PACK_LABELS.questionNo(3))
    expect(labels.countOf('笔记', 3)).toBe(DEFAULT_PACK_LABELS.countOf('笔记', 3))
  })

  it('词典有键时用词典，并给题号与计数传插值', () => {
    const seen: string[] = []
    const labels = packLabels((key, options) => {
      seen.push(key)
      if (key === 'study.pack.questionNo') return `Question ${options?.n}`
      if (key === 'study.pack.countOf') return `${options?.n} ${options?.unit}`
      return `t:${key}`
    })
    expect(labels.toc).toBe('t:study.pack.toc')
    expect(labels.questionNo(7)).toBe('Question 7')
    expect(labels.countOf('Notes', 3)).toBe('3 Notes')
    expect(seen).toContain('study.pack.countOf')
  })
})

describe('studyPackFileName', () => {
  it('清掉文件系统非法字符并加后缀', () => {
    expect(studyPackFileName('人类简史', '学习包')).toBe('人类简史-学习包.html')
    expect(studyPackFileName('a/b:c', 'pack')).toBe('a_b_c-pack.html')
    expect(studyPackFileName('   ', '')).toBe('book-pack.html')
  })
})

describe('buildPackHtml', () => {
  const base = {
    book: {
      title: '人类简史',
      author: '尤瓦尔',
      chapters: [
        { id: 'c1', title: '第一章', summary: '正文一' },
        { id: 'c2', title: '第二章', summary: '```mermaid\ngraph TD\nA-->B\n```' },
      ],
      overallSummary: '全书综述',
    },
    labels: DEFAULT_PACK_LABELS,
    notes: [note({ chapterTitle: '第二章' })],
    quiz: { questions: [{ question: '哪一种是跨学科？', options: ['单一', '多元'], answerIndex: 1 }] },
    answers: { q1: { picked: 0, correct: false } },
    now: new Date('2026-03-04T05:06:00').getTime(),
  }

  it('组装出含书名、笔记、自测与作答标记的单文件 HTML', async () => {
    const result = await buildPackHtml({
      ...base,
      images: false,
      charts: charts(),
      resolveColor: () => '#b5321f',
    })
    expect(result.filename).toBe('人类简史-学习包.html')
    expect(result.images).toBe(0)
    expect(result.failed).toEqual([])
    expect(result.html).toContain('人类简史')
    expect(result.html).toContain('反过来想')
    expect(result.html).toContain('哪一种是跨学科？')
    expect(result.html).toContain('正确答案')
    expect(result.html).toContain('你的选择')
    expect(result.html).toContain('查理·芒格')
    // 自包含：没有任何外部资源引用
    expect(result.html).not.toMatch(/(src|href)="https?:/)
  })

  it('内嵌 mermaid 图，并把渲染失败的图收进 failed 而不中止导出', async () => {
    const ok = await buildPackHtml({
      ...base,
      renderSvg: async () => ({ ok: true, svg: '<svg><text>A</text></svg>' }),
    })
    expect(ok.images).toBe(1)
    expect(ok.failed).toEqual([])
    expect(ok.html).toContain('data:image/svg+xml')

    const bad = await buildPackHtml({
      ...base,
      renderSvg: async () => ({ ok: false, error: '语法错' }),
    })
    expect(bad.images).toBe(0)
    expect(bad.failed).toEqual(['第二章'])
    expect(bad.html).toContain('反过来想')
  })

  it('没有自测/作答时也照样出包', async () => {
    const result = await buildPackHtml({ ...base, quiz: null, answers: {}, images: false })
    expect(result.html).toContain('人类简史')
    expect(result.html).not.toContain('正确答案')
  })

  it('图谱（人物关系图）也画进包里：自绘 SVG、图题取文案、不外链', async () => {
    const result = await buildPackHtml({
      ...base,
      // 去掉 mermaid 图块，让图片数只反映自绘的图谱
      book: { ...base.book, chapters: [base.book.chapters[0]] },
      charts: charts(),
      resolveColor: () => '#b5321f',
    })
    expect(result.images).toBe(1)
    expect(result.html).toContain('人物关系图')
    expect(result.html).toContain('查理·芒格')
    expect(result.html).toContain('data:image/svg+xml')
    expect(result.html).not.toMatch(/(src|href)="https?:/)
    // `images: false` 是「整包不出图」，连自绘的图谱也不画
    const skipped = await buildPackHtml({
      ...base,
      book: { ...base.book, chapters: [base.book.chapters[0]] },
      charts: charts(),
      images: false,
    })
    expect(skipped.images).toBe(0)
    expect(skipped.html).not.toContain('人物关系图')
  })
})
