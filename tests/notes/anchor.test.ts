import { describe, expect, it } from 'vitest'
import { createNoteResolver, foldText, normalizeText, noteSearchText, resolveNote, type NoteAnchor } from '@/notes/anchor'

/** 断言命中并要求非空，后续访问才有类型收窄（与 notesSync.test.ts 的写法一致） */
const mustAnchor = (anchor: NoteAnchor | null): NoteAnchor => {
  expect(anchor).not.toBeNull()
  if (!anchor) throw new Error('应当命中锚点，但返回了 null')
  return anchor
}

/** 命中片段在归一化章节文本上的原文 */
const sliceOf = (text: string, anchor: NoteAnchor): string => normalizeText(text).slice(anchor.start, anchor.end)

/** 与引用无关的长填充：用来把「字面更像的那处」推到上下文命中点 40 字以外 */
const FILLER_UNIT = '雾气弥漫在松林之间水珠沿着叶尖滑落远处传来鸟鸣'

describe('归一化与折叠', () => {
  it('normalizeText：空白折叠为单空格并 trim（与 notes.ts 的 squash 同语义）', () => {
    expect(normalizeText('  他把\n\n行囊\t放在  门口。 ')).toBe('他把 行囊 放在 门口。')
    expect(normalizeText('    ')).toBe('')
  })

  it('foldText：再去掉大小写、空白、标点与符号，保留字母数字与 CJK', () => {
    expect(foldText('Hello, World! 第 3 章……')).toBe('helloworld第3章')
    expect(foldText('他 站 在\u3000山脊上，眺望。')).toBe('他站在山脊上眺望')
  })
})

describe('exact：逐字命中', () => {
  it('单处命中：下标落在归一化文本上，score = 1', () => {
    const chapter = '第一章 起风了\n\n他在山脊上站了很久，直到云海翻涌。'
    const quote = '他在山脊上站了很久'
    const anchor = mustAnchor(resolveNote({ quote }, chapter))
    // 归一化会吃掉换行，所以下标只能拿归一化后的文本来对
    const at = normalizeText(chapter).indexOf(quote)
    expect(anchor).toEqual({ kind: 'exact', start: at, end: at + quote.length, score: 1 })
    expect(sliceOf(chapter, anchor)).toBe(quote)
  })

  it('多处命中：靠 prefix 选中最匹配的那一处，而不是最靠前的那一处', () => {
    const chapter = '山上很冷。风很小。山下很热。风很小。别再刮了。'
    const text = normalizeText(chapter)
    const first = text.indexOf('风很小')
    const second = text.indexOf('风很小', first + 1)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first) // 前提：这句话确实出现两次

    const anchor = mustAnchor(resolveNote({ quote: '风很小', prefix: '山下很热。' }, chapter))
    expect(anchor.kind).toBe('exact')
    expect(anchor.start).toBe(second)
  })

  it('多处命中：suffix 同样参与选择', () => {
    const chapter = '风很小。后面是甲。风很小。后面是乙。'
    const text = normalizeText(chapter)
    const first = text.indexOf('风很小')
    const second = text.indexOf('风很小', first + 1)

    const anchor = mustAnchor(resolveNote({ quote: '风很小', suffix: '。后面是乙。' }, chapter))
    expect(anchor.start).toBe(second)
  })

  it('无前后文时取最靠前的一处（稳定、可预期）', () => {
    const chapter = '风很小。风很小。'
    expect(mustAnchor(resolveNote({ quote: '风很小' }, chapter))).toEqual({ kind: 'exact', start: 0, end: 3, score: 1 })
  })

  it('空白折叠后仍命中：原文里的换行与多空格不影响定位', () => {
    const chapter = '他把  行囊\n\n放在\n门口。'
    const quote = '把 行囊 放在 门口'
    const anchor = mustAnchor(resolveNote({ quote }, chapter))
    expect(anchor.kind).toBe('exact')
    expect(sliceOf(chapter, anchor)).toBe(quote)
    expect(sliceOf(chapter, anchor)).toContain('行囊')
  })
})

describe('tolerant：忽略大小写与标点', () => {
  it('英文大小写与逗号不同：折叠后命中，下标映射回归一化文本', () => {
    const chapter = 'The Quick, Brown Fox!'
    const anchor = mustAnchor(resolveNote({ quote: 'the quick brown fox' }, chapter))
    expect(anchor.kind).toBe('tolerant')
    expect(anchor.score).toBe(0.9)
    // 折叠掉的是句中标点与句末感叹号，选区仍落在原文上
    expect(sliceOf(chapter, anchor)).toBe('The Quick, Brown Fox')
  })

  it('中文标点被规范化（直引号换全角引号）仍能定位', () => {
    const chapter = '他说：“今天不走。”然后转身。'
    const quote = '他说:"今天不走。"然后转身。'
    const anchor = mustAnchor(resolveNote({ quote }, chapter))
    expect(anchor.kind).toBe('tolerant')
    expect(sliceOf(chapter, anchor)).toContain('今天不走')
    // 不变量：选区折叠后与引用折叠后完全一致
    expect(foldText(sliceOf(chapter, anchor))).toBe(foldText(quote))
  })

  it('折叠后多次出现时同样用上下文挑位置（走 tolerant 这一级）', () => {
    const chapter = '他说「风,很小」。隔了很久，他又说「风,很小」。'
    const quote = '风很小'
    const anchor = mustAnchor(resolveNote({ quote, prefix: '他又说「' }, chapter))
    expect(anchor.kind).toBe('tolerant')
    expect(sliceOf(chapter, anchor)).toBe('风,很小')
    expect(anchor.start).toBe(normalizeText(chapter).lastIndexOf('风,很小'))
  })
})

describe('fuzzy：正文被改写过', () => {
  it('改了几个字仍能命中：score ≥ 0.6 且落回原句附近', () => {
    const chapter = '清晨的山谷里开满了野花，溪水从石缝间缓缓流过，鸟鸣声此起彼伏。'
    const quote = '清晨的山谷里开满了野花，溪水从石缝间缓缓流行' // 末二字被改写
    const anchor = mustAnchor(resolveNote({ quote }, chapter))
    expect(anchor.kind).toBe('fuzzy')
    expect(anchor.score).toBeGreaterThanOrEqual(0.6)
    const slice = sliceOf(chapter, anchor)
    expect(slice.startsWith('清晨的山谷里开满了野花')).toBe(true)
    expect(foldText(slice)).toContain('溪水从石缝间缓缓流')
  })

  it('有前后文时优先在上下文附近找，即使别处字面更像', () => {
    const quote = '他站在山脊上眺望'
    const far = '他站在山脊上眺看' // 只差末尾一字，字面更像
    const near = '他站在山颠上眺望' // 中间一字不同，字面差一点
    const chapter = `${far}。${FILLER_UNIT.repeat(3)}第二段。${near}。`

    // 没有上下文：全篇取最高分，选到字面更像的 far
    const blind = mustAnchor(resolveNote({ quote }, chapter))
    expect(blind.kind).toBe('fuzzy')
    expect(sliceOf(chapter, blind)).toContain('他站在山脊上眺')
    expect(sliceOf(chapter, blind)).not.toContain('颠')

    // 给了 prefix：即使 far 分数更高，也只在上下文命中点附近选，落回 near
    const guided = mustAnchor(resolveNote({ quote, prefix: '第二段。' }, chapter))
    expect(guided.kind).toBe('fuzzy')
    expect(sliceOf(chapter, guided)).toContain('颠')
  })
})

describe('找不到就返回 null', () => {
  it('空引用（归一化后为空）无从找起', () => {
    expect(resolveNote({ quote: '' }, '任何正文都在这里。')).toBeNull()
    expect(resolveNote({ quote: '   \n\t ' }, '任何正文都在这里。')).toBeNull()
  })

  it('正文为空：任何引用都定位不到', () => {
    expect(resolveNote({ quote: '他站在山脊上' }, '')).toBeNull()
    expect(resolveNote({ quote: '他站在山脊上' }, '\n\n  ')).toBeNull()
  })

  it('相似度不够（引用与正文毫无共同点）返回 null', () => {
    const chapter = '春天的山谷里开满了野花，溪水从石缝间缓缓流过。'
    const anchor = resolveNote({ quote: '他站在山脊上眺望远方的云海，心里忽然安静下来' }, chapter)
    expect(anchor).toBeNull()
  })

  it('引用比整章还长、且毫无共同点，也不会误报', () => {
    expect(resolveNote({ quote: '他站在山脊上眺望' }, '春天的山谷里开满了野花。')).toBeNull()
  })
})

describe('长文本的耗时', () => {
  it('2 万字以上章节：fuzzy 全篇扫描仍在宽松时限内完成', () => {
    const passage =
      '清晨的山谷里开满了野花，溪水从石缝间缓缓流过，鸟鸣声此起彼伏，他独自坐在石头上，看着云雾从谷底一层层涌上来，忽然觉得心里那些纠缠不清的事情都变轻了。'
    const quote = passage.replace('流过', '流去') // 一个字的改写：exact / tolerant 都会落空
    const filler = FILLER_UNIT.repeat(500) // 单侧 11500 字
    const chapter = `${filler}${passage}${filler}`
    expect(normalizeText(chapter).length).toBeGreaterThan(20_000)

    const startedAt = performance.now()
    const anchor = mustAnchor(resolveNote({ quote }, chapter))
    const elapsed = performance.now() - startedAt

    expect(anchor.kind).toBe('fuzzy')
    expect(anchor.score).toBeGreaterThanOrEqual(0.6)
    // 粗扫步长放大后仍会精修：起点要对齐到「清晨」，而不是网格上离得最近的那一格
    expect(sliceOf(chapter, anchor).startsWith('清晨的山谷里开满了野花')).toBe(true)
    // 步长会被放大到 ceil(长度 / 4000)，这里只要求「不卡」这种量级的宽松上限
    expect(elapsed).toBeLessThan(3000)
  })
})

describe('createNoteResolver：一章多条笔记共用折叠结果', () => {
  it('逐条结果与 resolveNote 完全一致（exact / tolerant / fuzzy / null 全覆盖）', () => {
    const chapter =
      '第一段：他坚持认为这是公司最关键的转折点。\n\n第二段：他说：“先读完，再动手。”\n\n第三段：春天的山谷里开满了野花。'
    const notes = [
      { quote: '这是公司最关键的转折点' },
      { quote: '先读完再动手' },
      { quote: '春天的山谷里开满了野花' },
      { quote: '这句话整章都没有' },
      { quote: '' },
    ]
    const resolver = createNoteResolver(chapter)
    for (const note of notes) {
      expect(resolver.resolve(note)).toEqual(resolveNote(note, chapter))
    }
  })

  it('同一份正文重复定位多次，结果稳定（不会因为共用缓存而漂移）', () => {
    const chapter = '他在山脊上站了很久，直到云海翻涌。后来他下山了。'
    const resolver = createNoteResolver(chapter)
    const first = resolver.resolve({ quote: '他下山了' })
    const second = resolver.resolve({ quote: '他下山了' })
    expect(second).toEqual(first)
    expect(mustAnchor(second).kind).toBe('exact')
  })

  it('整章定位上百条笔记也不会慢到离谱（宽松上限）', () => {
    const filler = FILLER_UNIT.repeat(500) // 11500 字
    const chapter = `${filler}${'他在山脊上站了很久，直到云海翻涌。'}${filler}`
    const notes = Array.from({ length: 100 }, (_, i) => ({ quote: i % 2 === 0 ? '他在山脊上站了很久' : `整章都没有的第${i}句` }))
    const resolver = createNoteResolver(chapter)
    const startedAt = performance.now()
    for (const note of notes) resolver.resolve(note)
    const elapsed = performance.now() - startedAt
    expect(elapsed).toBeLessThan(3000)
  })

  it('带标点的两万字散文 + 几十条找不到的引文：不走全篇 step=1 的慢路径', () => {
    // 现实长章：归一化两万字出头，标点占一成左右。旧实现用「折叠后长度」判长短，
    // 这种文本折叠后仍有 1.8 万字，落在 step=1，每条 30 字引文要滑完全篇（审查实测 306ms/条）。
    const sentence = '他在山脊上站了很久，直到云海翻涌；风把松针吹得沙沙响。'
    const chapter = sentence.repeat(10).repeat(75)
    expect(normalizeText(chapter).length).toBeGreaterThan(20000)
    expect(foldText(chapter).length).toBeLessThan(normalizeText(chapter).length * 0.95)

    const resolver = createNoteResolver(chapter)
    // 正确性：深处那句的确切引文仍然准确定位
    const deep = mustAnchor(resolver.resolve({ quote: '风把松针吹得沙沙响' }))
    expect(deep.kind).toBe('exact')
    expect(sliceOf(chapter, deep)).toContain('松针')

    // 120 条全落空是最坏路径：没有上限预筛时，每条都要滑完整个粗扫网格（审查实测 76ms/条，合计 9 秒）
    const notes = Array.from({ length: 120 }, (_, i) => ({ quote: `整章都没有的第${i}句，也没有相邻上下文` }))
    const startedAt = performance.now()
    for (const note of notes) expect(resolver.resolve(note)).toBeNull()
    const elapsed = performance.now() - startedAt
    // 上限预筛（Σ min(引用计数, 正文计数) 达不到阈值就直接判 null）必须把这条路径压到毫秒级
    expect(elapsed).toBeLessThan(2500)
  })
})

describe('noteSearchText：与正文高亮同一口径', () => {
  it('围栏代码块（普通代码与富内容块）里的文字不算可定位正文', () => {
    const md = [
      '正文一。',
      '',
      '```js',
      'const hot = true',
      '```',
      '',
      '正文二。',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n')
    const searchable = noteSearchText(md)
    expect(searchable).toContain('正文一。')
    expect(searchable).toContain('正文二。')
    expect(searchable).not.toContain('const hot = true')
    expect(searchable).not.toContain('graph TD')
    // 与正文高亮同一套判定：这些引文在两侧都必须被判成「找不到」
    expect(createNoteResolver(searchable).resolve({ quote: 'const hot = true' })).toBeNull()
    expect(createNoteResolver(searchable).resolve({ quote: 'graph TD; A-->B' })).toBeNull()
    expect(createNoteResolver(searchable).resolve({ quote: '正文二。' })).not.toBeNull()
  })

  it('未闭合的围栏按「之后都算块」处理（输出被截断时不残留可定位文字）', () => {
    const md = '正文一。\n\n```genui\n{"type":"card"'
    const searchable = noteSearchText(md)
    expect(searchable).toContain('正文一。')
    expect(searchable).not.toContain('card')
  })

  it('行内代码仍在可定位正文里（正文高亮会把它包进 mark）', () => {
    const md = '用 `map` 记下这件事，很有用。'
    expect(noteSearchText(md)).toContain('map')
    expect(createNoteResolver(noteSearchText(md)).resolve({ quote: '用 map 记下这件事' })).not.toBeNull()
  })

  it('空输入返回空串，不抛异常', () => {
    expect(noteSearchText('')).toBe('')
  })
})

