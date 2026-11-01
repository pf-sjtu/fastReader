/**
 * 离线学习包接线层（`src/study/exportPack.ts`）的测试。
 *
 * 这里只测「接线」，不重复测 `src/study/pack/**` 的纯渲染（那是 `tests/study/pack.test.ts`）：
 * 笔记怎么归位、人物志怎么挑、mermaid 图从哪来、色值怎么解析、i18n 文案怎么落到包里。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BookCharts } from '@/charts/types'
import type { Note } from '@/notes/notes'
import i18n from '@/i18n'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { DEFAULT_PACK_LABELS, DEFAULT_PACK_LANG, NOTE_PALETTE } from '@/study/pack'
import {
  PACK_ENTITY_PALETTE,
  buildPackHtml,
  currentPackLang,
  mermaidSourcesOf,
  packLabels,
  packLangOf,
  packNotesOf,
  peopleOf,
  resolveEntityColor,
  studyPackFileName,
  type PackChapterSource,
} from '@/study/exportPack'

const INDEX_CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

/** 取 :root（亮色）或 .dark（暗色）块里某个 token 的原值（`--` 前缀不要带） */
function cssTokenOf(name: string, theme: 'light' | 'dark'): string {
  const open = theme === 'light' ? /:root\s*\{/ : /\.dark\s*\{/
  const start = open.exec(INDEX_CSS)
  if (!start) throw new Error(`index.css 找不到 ${theme === 'light' ? ':root' : '.dark'} 块`)
  const block = INDEX_CSS.slice(start.index, INDEX_CSS.indexOf('}', start.index))
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)
  if (!m) throw new Error(`${theme} 主题缺少 --${name}`)
  return m[1].trim()
}

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

describe('resolveEntityColor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('取固定亮色实体色表，与当前主题无关', () => {
    // 暗色主题把 --entity-N 提亮到 0.68–0.80，而学习包纸面固定亮色：
    // 取暗色值会让实体色对纸面的对比度掉到 1.69–2.57:1。
    // 这里直接让 getComputedStyle 抛异常 —— 只要实现回头去读当前主题，本测试立刻炸。
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('不应读取当前主题的计算值')
    })
    expect(resolveEntityColor('var(--entity-1)')).toBe('oklch(0.5200 0.1700 32.0)')
    expect(resolveEntityColor(' var( --entity-3 ) ')).toBe('oklch(0.5800 0.1200 80.0)')
    expect(resolveEntityColor('var(--entity-neutral)')).toBe('oklch(0.5200 0.0150 70.0)')
  })

  it('不是变量写法 / 变量不在表里时退回 currentColor，绝不返回空串', () => {
    expect(resolveEntityColor('#b5321f')).toBe('currentColor')
    expect(resolveEntityColor('var(--entity-99)')).toBe('currentColor')
    expect(resolveEntityColor('var(--chart-1)')).toBe('currentColor')
    // 带兜底值的 var：兜底值只在变量缺失时有意义，变量名认出来就用亮色表
    expect(resolveEntityColor('var(--entity-7, red)')).toBe(PACK_ENTITY_PALETTE['--entity-7'])
  })
})

describe('PACK_ENTITY_PALETTE', () => {
  it('逐字等于 index.css 亮色 token（token 改值就必须同步这张表）', () => {
    // 与 buildPack.ts 的 NOTE_PALETTE 同一约定：这张表是亮色 token 的副本，不能各改各的
    expect(Object.keys(PACK_ENTITY_PALETTE)).toHaveLength(11)
    for (const [name, value] of Object.entries(PACK_ENTITY_PALETTE)) {
      expect(value, name).toBe(cssTokenOf(name.replace(/^--/, ''), 'light'))
    }
  })

  it('暗色主题确实把实体色提亮了 —— 这正是当初固定取亮色表的理由', () => {
    // 哪天暗色不再提亮实体色，这条会先失败，提醒重新评估「固定亮色表」是否还必要
    const light = Number(/^oklch\(([\d.]+)/.exec(cssTokenOf('entity-1', 'light'))?.[1])
    const dark = Number(/^oklch\(([\d.]+)/.exec(cssTokenOf('entity-1', 'dark'))?.[1])
    expect(dark).toBeGreaterThan(light)
  })
})

describe('NOTE_PALETTE', () => {
  it('逐字等于 index.css 亮色 token（primary / info / success / warning）', () => {
    // 与 PACK_ENTITY_PALETTE 同一约定：学习包固定亮色纸面，这张表是亮色 token 的副本
    const names = ['primary', 'info', 'success', 'warning'] as const
    names.forEach((name, index) => {
      expect(NOTE_PALETTE[(index + 1) as 1 | 2 | 3 | 4], name).toBe(cssTokenOf(name, 'light'))
    })
  })

  it('暗色主题的四色确实比亮色更亮 —— 所以绝不能用当前主题的计算值', () => {
    for (const name of ['primary', 'info', 'success', 'warning']) {
      const light = Number(/^oklch\(([\d.]+)/.exec(cssTokenOf(name, 'light'))?.[1])
      const dark = Number(/^oklch\(([\d.]+)/.exec(cssTokenOf(name, 'dark'))?.[1])
      expect(dark, name).toBeGreaterThan(light)
    }
  })
})

describe('packLangOf', () => {
  it('中文（zh / zh-CN / zh-TW）归到 zh-CN，其它语言归到 en，未知退回默认', () => {
    expect(packLangOf('zh')).toBe('zh-CN')
    expect(packLangOf('zh-CN')).toBe('zh-CN')
    expect(packLangOf('zh-TW')).toBe('zh-CN')
    expect(packLangOf('en')).toBe('en')
    expect(packLangOf('en-US')).toBe('en')
    for (const missing of [undefined, '', '   ']) {
      expect(packLangOf(missing)).toBe(DEFAULT_PACK_LANG)
    }
  })

  it('currentPackLang 读的是当前界面语言', async () => {
    const before = i18n.language
    try {
      await i18n.changeLanguage('en')
      expect(currentPackLang()).toBe('en')
      await i18n.changeLanguage('zh')
      expect(currentPackLang()).toBe('zh-CN')
    } finally {
      await i18n.changeLanguage(before)
    }
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

  it('PackLabels 的每个键都在两份 locale 里有文案（动态 key 逃过 uiLocales 的字面量扫描）', () => {
    const keys = Object.keys(DEFAULT_PACK_LABELS).filter((k) => k !== 'questionNo' && k !== 'countOf')
    expect(keys.length).toBeGreaterThan(15)
    for (const key of keys) {
      expect(zh, `zh 缺 study.pack.${key}`).toHaveProperty(`study.pack.${key}`)
      expect(en, `en 缺 study.pack.${key}`).toHaveProperty(`study.pack.${key}`)
    }
  })
})

describe('studyPackFileName', () => {
  it('清掉文件系统非法字符并加后缀', () => {
    expect(studyPackFileName('人类简史', '学习包')).toBe('人类简史-学习包.html')
    expect(studyPackFileName('a/b:c', 'pack')).toBe('a_b_c-pack.html')
    expect(studyPackFileName('   ', '')).toBe('book-pack.html')
  })

  it('超长标题截到 80 字符，后缀原样保留', () => {
    const name = studyPackFileName('长'.repeat(120), '学习包')
    // 76 个「长」+ '-' + '学习包' + '.html'
    expect(name).toBe(`${'长'.repeat(76)}-学习包.html`)
    expect(Array.from(name).length).toBe(85)
    expect(name.endsWith('-学习包.html')).toBe(true)
  })

  it('按码点截断，不会把 emoji 劈成半个代理对', () => {
    const name = studyPackFileName('🎉'.repeat(120), 'p')
    // 去掉后缀与连字符后剩 78 个完整 emoji
    expect(name).toBe(`${'🎉'.repeat(78)}-p.html`)
    // 出现孤立的代理项就说明截断切错了：整个文件名应是合法 UTF-16 序列
    expect(() => encodeURIComponent(name)).not.toThrow()
    expect([...name].filter((c) => c === '🎉')).toHaveLength(78)
  })
})

describe('buildPackHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('文档语言默认跟随界面语言，也可由调用方指定', async () => {
    const result = await buildPackHtml({
      ...base,
      images: false,
      resolveColor: () => '#b5321f',
      lang: 'en',
    })
    expect(result.html).toContain('<html lang="en">')

    const before = i18n.language
    try {
      await i18n.changeLanguage('en')
      const followed = await buildPackHtml({ ...base, images: false, resolveColor: () => '#b5321f' })
      expect(followed.html).toContain('<html lang="en">')
      await i18n.changeLanguage('zh')
      const zhPack = await buildPackHtml({ ...base, images: false, resolveColor: () => '#b5321f' })
      expect(zhPack.html).toContain('<html lang="zh-CN">')
    } finally {
      await i18n.changeLanguage(before)
    }
  })

  it('不传 resolveColor 时用固定亮色实体色表，暗色主题的提亮值一个都不出现', async () => {
    // 学习包纸面固定亮色，实体色若跟着当前主题走，暗色下对比度会掉到 1.69–2.57:1：
    // 让 getComputedStyle 抛异常，确保这条路径完全不碰当前主题。
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('不应读取当前主题的计算值')
    })
    const result = await buildPackHtml({
      ...base,
      // 去掉 mermaid 图块，让断言只面对实体色（图题渲染无关）
      book: { ...base.book, chapters: [base.book.chapters[0]] },
      charts: charts(),
      images: false,
    })
    expect(result.html).toContain('查理·芒格')
    const used = Object.entries(PACK_ENTITY_PALETTE).filter(([, value]) => result.html.includes(value))
    expect(used.length).toBeGreaterThan(0)
    for (const [name] of used) {
      expect(result.html, name).not.toContain(cssTokenOf(name.replace(/^--/, ''), 'dark'))
    }
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
