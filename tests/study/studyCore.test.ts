import { describe, it, expect } from 'vitest'
import { parseQuiz, parseStudyKit, STUDY_LIMITS } from '@/study/schema'
import { extractCitations, linkifyCitations, retrieveChapters, tokenize } from '@/study/retrieve'

const chapters = [
  { id: 'c1', title: '第1章 序幕' },
  { id: 'c2', title: '第2章 私有化方案' },
  { id: 'c3', title: '第3章 KKR 登场' },
]

describe('parseStudyKit', () => {
  const kit = (items: unknown[]) => '```json\n' + JSON.stringify({ version: 1, chapters: items }) + '\n```'

  it('解析围栏 JSON，章节标题映射回真实 id', () => {
    const r = parseStudyKit(
      kit([
        { chapterTitle: '第2章 私有化方案', oneLiner: '约翰逊提出私有化', points: ['a', 'b', 'c'], terms: [{ term: '杠杆收购', definition: '用债务收购' }] },
        { chapterTitle: '第3章', oneLiner: 'KKR 入场', points: ['x'] },
      ]),
      chapters
    )!
    expect(r.chapters.map((c) => c.chapterId)).toEqual(['c2', 'c3'])
    expect(r.chapters[0].terms).toEqual([{ term: '杠杆收购', definition: '用债务收购' }])
    expect(r.chapters[1].terms).toEqual([])
  })

  it('坏条目只丢自己：缺字段/空要点/类型错', () => {
    const r = parseStudyKit(
      kit([{ chapterTitle: '第1章', oneLiner: '', points: ['a'] }, { chapterTitle: '第2章', oneLiner: 'ok', points: [] }, 'oops', { chapterTitle: '第3章', oneLiner: 'fine', points: ['p'] }]),
      chapters
    )!
    expect(r.chapters.map((c) => c.chapterId)).toEqual(['c3'])
  })

  it('同一章重复只留第一条；对不上的章节保留但 chapterId=null', () => {
    const r = parseStudyKit(
      kit([
        { chapterTitle: '第1章', oneLiner: '甲', points: ['p'] },
        { chapterTitle: '序幕', oneLiner: '乙（重复）', points: ['p'] },
        { chapterTitle: '完全无关的标题XYZ', oneLiner: '丙', points: ['p'] },
      ]),
      chapters
    )!
    expect(r.chapters.map((c) => [c.chapterId, c.oneLiner])).toEqual([['c1', '甲'], [null, '丙']])
  })

  it('要点/术语数量受上限约束', () => {
    const r = parseStudyKit(
      kit([{ chapterTitle: '第1章', oneLiner: 'x', points: Array.from({ length: 9 }, (_, i) => `p${i}`), terms: Array.from({ length: 9 }, (_, i) => ({ term: `t${i}`, definition: 'd' })) }]),
      chapters
    )!
    expect(r.chapters[0].points).toHaveLength(STUDY_LIMITS.points)
    expect(r.chapters[0].terms).toHaveLength(STUDY_LIMITS.terms)
  })

  it('非 JSON / 无 chapters / 全部坏条目 → null', () => {
    expect(parseStudyKit('抱歉，我无法完成', chapters)).toBeNull()
    expect(parseStudyKit('{"foo":1}', chapters)).toBeNull()
    expect(parseStudyKit('{"chapters":[{"x":1}]}', chapters)).toBeNull()
    expect(parseStudyKit('{"chapters":[', chapters)).toBeNull()
  })
})

describe('parseQuiz', () => {
  const quiz = (qs: unknown[]) => JSON.stringify({ questions: qs })

  it('选择题与简答题；章节映射；id 顺序编号', () => {
    const r = parseQuiz(
      quiz([
        { type: 'choice', question: '谁提出私有化？', options: ['约翰逊', 'KKR', '薛利'], answerIndex: 0, explanation: '见第2章', chapterTitle: '第2章' },
        { type: 'short', question: '为什么失败？', answer: '出价不如 KKR', chapterTitle: '第3章 KKR 登场' },
      ]),
      chapters
    )!
    expect(r.questions.map((q) => [q.id, q.type, q.chapterId])).toEqual([['q1', 'choice', 'c2'], ['q2', 'short', 'c3']])
    expect(r.questions[0].answerIndex).toBe(0)
    expect(r.questions[1].answer).toBe('出价不如 KKR')
  })

  it('无效题被过滤：选项过少/答案越界/缺答案/类型未知', () => {
    const r = parseQuiz(
      quiz([
        { type: 'choice', question: 'q', options: ['a'], answerIndex: 0 },
        { type: 'choice', question: 'q', options: ['a', 'b'], answerIndex: 2 },
        { type: 'choice', question: 'q', options: ['a', 'b'] },
        { type: 'short', question: 'q' },
        { type: 'essay', question: 'q', answer: 'a' },
        { type: 'choice', question: '合法', options: ['a', 'b'], answerIndex: 1 },
      ]),
      chapters
    )!
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].question).toBe('合法')
    expect(r.questions[0].id).toBe('q1')
  })

  it('题数封顶；全部无效 → null', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ type: 'short', question: `q${i}`, answer: 'a' }))
    expect(parseQuiz(quiz(many), chapters)!.questions).toHaveLength(STUDY_LIMITS.questions)
    expect(parseQuiz(quiz([{ type: 'short', question: 'q' }]), chapters)).toBeNull()
  })
})

describe('tokenize / retrieveChapters', () => {
  const docs = [
    { id: 'c1', title: '第1章 序幕', summary: '纳贝斯克首席执行官罗斯·约翰逊的日常，公司业务与烟草。' },
    { id: 'c2', title: '第2章 私有化方案', summary: '约翰逊提出杠杆收购私有化方案，融资结构复杂。' },
    { id: 'c3', title: '第3章 KKR 登场', summary: 'KKR 以更高价格介入竞购，杠杆收购成为焦点。' },
    { id: 'c4', title: '第4章 尾声', summary: '交易结束，各方反思。' },
  ]

  it('tokenize：CJK 二元组、拉丁词、去掉疑问虚词', () => {
    expect(tokenize('KKR 是什么')).toEqual(['kkr'])
    expect(tokenize('杠杆收购')).toEqual(['杠杆', '杆收', '收购'])
    expect(tokenize('a')).toEqual([])
    expect(tokenize('')).toEqual([])
  })

  it('命中最相关章节；标题命中加权；无命中返回空', () => {
    expect(retrieveChapters('KKR 做了什么', docs)[0].id).toBe('c3')
    expect(retrieveChapters('私有化方案', docs)[0].id).toBe('c2')
    expect(retrieveChapters('量子力学', docs)).toEqual([])
    expect(retrieveChapters('', docs)).toEqual([])
    expect(retrieveChapters('KKR', [])).toEqual([])
  })

  it('k 限制数量；分数降序；同分按 id 稳定', () => {
    const r = retrieveChapters('杠杆收购', docs, 2)
    expect(r).toHaveLength(2)
    expect(r.map((x) => x.id).sort()).toEqual(['c2', 'c3'])
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score)
  })

  it('区分度：每章都出现的词（高 df）权重低于只在一章出现的词', () => {
    const d = [
      { id: 'a', title: 'A', summary: '公司 公司 公司 公司' },
      { id: 'b', title: 'B', summary: '公司 稀有术语' },
      { id: 'c', title: 'C', summary: '公司' },
    ]
    expect(retrieveChapters('公司的稀有术语', d)[0].id).toBe('b')
  })
})

describe('linkifyCitations', () => {
  it('【标题】→ [【标题】](cite:id)：与 extractCitations 同一套匹配；映射不上的原样保留', () => {
    expect(linkifyCitations('方案【第2章】与【不存在】', chapters)).toBe('方案[【第2章】](cite:c2)与【不存在】')
    expect(linkifyCitations('无引用', chapters)).toBe('无引用')
    expect(linkifyCitations('', chapters)).toBe('')
  })

  it('标题里的方括号 / id 里的特殊字符不会破坏链接语法', () => {
    const cs = [{ id: 'a b)', title: '第[1]章' }]
    const out = linkifyCitations('见【第[1]章】', cs)
    expect(out).toContain('［1］') // 方括号转全角，不会截断链接文字
    expect(out).toContain('(cite:a%20b%29)')
  })
})

describe('extractCitations', () => {
  it('提取【…】引用并映射章节；去重、保序、丢弃映射不上的', () => {
    const ans = '约翰逊提出方案【第2章】，KKR 随后入局【第3章 KKR 登场】，再次提到【第2章】。参考【不存在的东西】。'
    expect(extractCitations(ans, chapters)).toEqual(['c2', 'c3'])
    expect(extractCitations('没有引用', chapters)).toEqual([])
    expect(extractCitations('', chapters)).toEqual([])
  })
})
