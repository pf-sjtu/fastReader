import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStudyStore, studyDeps, resetAutoTried } from '@/study/studyStore'
import { emptyStudyData, sanitizeStudyData, studyKeyOf, type StudyBackend, type StudyData } from '@/study/persistence'
import { applyDepth, kitCoverage, renderStudyChapter } from '@/study/depth'
import type { Quiz, StudyKit } from '@/study/schema'

const mkBook = (suffix = '', n = 3) => ({
  title: `书${suffix}`,
  overallSummary: '全书总结：约翰逊与 KKR 的收购之争。',
  chapters: Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    title: `第${i + 1}章`,
    content: '',
    processed: true,
    summary: i === 1 ? '约翰逊提出杠杆收购方案。' : `第${i + 1}章的总结${suffix}`,
  })),
})

const kit: StudyKit = {
  version: 1,
  chapters: [{ chapterId: 'c2', chapterTitle: '第2章', oneLiner: '提出方案', points: ['p1', 'p2', 'p3'], terms: [{ term: '杠杆收购', definition: '用债务收购' }] }],
}
const quiz: Quiz = {
  version: 1,
  questions: [
    { id: 'q1', type: 'choice', question: '谁？', options: ['a', 'b'], answerIndex: 0, explanation: '', chapterId: 'c1', chapterTitle: '第1章' },
    { id: 'q2', type: 'short', question: '为何？', answer: '因为', explanation: '', chapterId: null, chapterTitle: '' },
  ],
}

function memoryBackend(seed: Record<string, StudyData> = {}) {
  const db = new Map(Object.entries(seed))
  const backend: StudyBackend = {
    load: async (k) => db.get(k) ?? null,
    save: async (k, d) => void db.set(k, d),
    remove: async (k) => void db.delete(k),
  }
  return { backend, db }
}

const ai = { generateStudyKit: vi.fn(), generateQuiz: vi.fn(), askBook: vi.fn() }
let mem = memoryBackend()

beforeEach(() => {
  vi.clearAllMocks()
  mem = memoryBackend()
  studyDeps.backend = mem.backend
  studyDeps.createAI = () => ai as never
  resetAutoTried()
  useStudyStore.setState({
    auto: true,
    bookKey: null,
    data: emptyStudyData(),
    chat: [],
    running: { kit: false, quiz: false, ask: false },
    kitProgress: null,
    errors: { kit: null, quiz: null },
  })
})

describe('studyKeyOf / sanitizeStudyData', () => {
  it('总结内容长度变了，键就变（旧速读包自动失效）', () => {
    const a = studyKeyOf(mkBook())
    expect(a).toBe(studyKeyOf(mkBook()))
    const b = mkBook()
    b.chapters[0].summary += '多了几个字'
    expect(studyKeyOf(b)).not.toBe(a)
    expect(studyKeyOf({ ...mkBook(), title: '别的书' })).not.toBe(a)
  })

  it('损坏/旧版数据：只保留结构正确的部分；答题记录只保留题目里存在的', () => {
    expect(sanitizeStudyData(null)).toEqual(emptyStudyData())
    expect(sanitizeStudyData({ kit: { version: 2 }, quiz: 'x' })).toEqual(emptyStudyData())
    const d = sanitizeStudyData({ kit, quiz, answers: { q1: { picked: 1, correct: false }, ghost: { picked: 0, correct: true }, q2: { correct: 'yes' } } })
    expect(d.kit).toEqual(kit)
    expect(d.answers).toEqual({ q1: { picked: 1, correct: false } })
  })
})

describe('bind', () => {
  it('加载该书已保存的数据；没有则为空', async () => {
    const book = mkBook()
    mem = memoryBackend({ [studyKeyOf(book)]: { kit, quiz: null, answers: {} } })
    studyDeps.backend = mem.backend
    await useStudyStore.getState().bind(book)
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    await useStudyStore.getState().bind(mkBook('X'))
    expect(useStudyStore.getState().data.kit).toBeNull()
  })

  it('换书时清空对话；加载期间旧书数据不残留', async () => {
    const a = mkBook('A')
    await useStudyStore.getState().bind(a)
    useStudyStore.setState({ chat: [{ id: 1, question: 'q', citations: [], pending: false }], data: { ...emptyStudyData(), kit } })
    await useStudyStore.getState().bind(mkBook('B'))
    expect(useStudyStore.getState().chat).toEqual([])
    expect(useStudyStore.getState().data.kit).toBeNull()
  })
})

describe('generateKit', () => {
  it('成功：写入 store 并落盘；进度回调；结束后复位', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.generateStudyKit.mockImplementation(async (_t, _c, _l, opts) => {
      opts.onBatch(1, 2)
      expect(useStudyStore.getState().running.kit).toBe(true)
      return kit
    })
    await useStudyStore.getState().generateKit(book)
    const s = useStudyStore.getState()
    expect(s.data.kit).toEqual(kit)
    expect(s.running.kit).toBe(false)
    expect(s.kitProgress).toBeNull()
    expect(mem.db.get(studyKeyOf(book))?.kit).toEqual(kit)
  })

  it('失败：记录错误，不写入数据', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.generateStudyKit.mockRejectedValue(new Error('HTTP 500'))
    await useStudyStore.getState().generateKit(book)
    expect(useStudyStore.getState().errors.kit).toBe('HTTP 500')
    expect(useStudyStore.getState().data.kit).toBeNull()
  })

  it('生成期间换书：旧书的结果丢弃，不污染新书，也不写进旧键', async () => {
    const a = mkBook('A')
    const b = mkBook('B')
    await useStudyStore.getState().bind(a)
    let release!: () => void
    ai.generateStudyKit.mockImplementation(() => new Promise((r) => (release = () => r(kit))))
    const p = useStudyStore.getState().generateKit(a)
    await useStudyStore.getState().bind(b)
    release()
    await p
    expect(useStudyStore.getState().data.kit).toBeNull()
    expect(mem.db.get(studyKeyOf(a))).toBeUndefined()
    expect(useStudyStore.getState().running.kit).toBe(false) // 新书的运行标志没被旧请求踩坏
  })

  it('没有可用总结：给出 noChapters，不发请求；运行中重复点击被忽略', async () => {
    const empty = { ...mkBook(), chapters: [] }
    await useStudyStore.getState().bind(empty)
    await useStudyStore.getState().generateKit(empty)
    expect(useStudyStore.getState().errors.kit).toBe('noChapters')
    expect(ai.generateStudyKit).not.toHaveBeenCalled()

    const book = mkBook()
    await useStudyStore.getState().bind(book)
    let release!: () => void
    ai.generateStudyKit.mockImplementation(() => new Promise((r) => (release = () => r(kit))))
    const p1 = useStudyStore.getState().generateKit(book)
    await useStudyStore.getState().generateKit(book)
    expect(ai.generateStudyKit).toHaveBeenCalledTimes(1)
    release()
    await p1
  })
})

describe('自测', () => {
  it('出题后可作答；同一题只记第一次；重新出题清空作答', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.generateQuiz.mockResolvedValue(quiz)
    await useStudyStore.getState().generateQuiz(book, 5)
    expect(ai.generateQuiz).toHaveBeenCalledWith('书', expect.any(Array), 5, expect.anything(), expect.anything())

    useStudyStore.getState().recordAnswer('q1', 1, false)
    useStudyStore.getState().recordAnswer('q1', 0, true) // 想改答案：忽略
    expect(useStudyStore.getState().data.answers.q1).toEqual({ picked: 1, correct: false })
    expect(mem.db.get(studyKeyOf(book))?.answers.q1.correct).toBe(false)

    await useStudyStore.getState().generateQuiz(book)
    expect(useStudyStore.getState().data.answers).toEqual({})
  })

  it('按章出题只传该章；resetAnswers 只清作答不清题目', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.generateQuiz.mockResolvedValue(quiz)
    await useStudyStore.getState().generateQuiz(book, 5, 'c2')
    expect(ai.generateQuiz.mock.calls[0][1].map((c: { id: string }) => c.id)).toEqual(['c2'])
    useStudyStore.getState().recordAnswer('q2', null, true)
    useStudyStore.getState().resetAnswers()
    expect(useStudyStore.getState().data.answers).toEqual({})
    expect(useStudyStore.getState().data.quiz).toEqual(quiz)
  })

  it('出题失败：错误可见，已有题目保留', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    useStudyStore.setState({ data: { ...emptyStudyData(), quiz } })
    ai.generateQuiz.mockRejectedValue(new Error('自测题 JSON 解析失败'))
    await useStudyStore.getState().generateQuiz(book)
    expect(useStudyStore.getState().errors.quiz).toContain('解析失败')
    expect(useStudyStore.getState().data.quiz).toEqual(quiz)
  })
})

describe('autoGenerate：章节总结稳定后自动补齐速读与全书自测', () => {
  const bound = async (b = mkBook()) => {
    await useStudyStore.getState().bind(b)
    return b
  }

  it('什么都没有：先速读、再全书自测（各一次），结果落盘', async () => {
    ai.generateStudyKit.mockResolvedValue(kit)
    ai.generateQuiz.mockResolvedValue(quiz)
    const b = await bound()
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).toHaveBeenCalledTimes(1)
    expect(ai.generateQuiz).toHaveBeenCalledTimes(1)
    expect(ai.generateQuiz.mock.calls[0][1]).toHaveLength(3) // 全书，不是单章
    const saved = mem.db.get(studyKeyOf(b))
    expect(saved?.kit).toEqual(kit)
    expect(saved?.quiz).toEqual(quiz)
  })

  it('已有的不重复生成：本地缓存里有速读就只补自测；两样都有就什么都不调', async () => {
    const b = mkBook()
    mem = memoryBackend({ [studyKeyOf(b)]: { kit, quiz: null, answers: {} } })
    studyDeps.backend = mem.backend
    ai.generateQuiz.mockResolvedValue(quiz)
    await bound(b)
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
    expect(ai.generateQuiz).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    resetAutoTried()
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
    expect(ai.generateQuiz).not.toHaveBeenCalled()
  })

  it('开关关着：不调用', async () => {
    useStudyStore.setState({ auto: false })
    const b = await bound()
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
    expect(ai.generateQuiz).not.toHaveBeenCalled()
  })

  it('速读失败：不接着烧自测，也不会自动重试（本会话每本书每种产物只试一次）', async () => {
    ai.generateStudyKit.mockRejectedValue(new Error('网络错误'))
    const b = await bound()
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateQuiz).not.toHaveBeenCalled()
    expect(useStudyStore.getState().errors.kit).toContain('网络错误')
    await useStudyStore.getState().autoGenerate(b) // 例如 effect 又触发了一次
    expect(ai.generateStudyKit).toHaveBeenCalledTimes(1)
  })

  it('用户正在操作（问书 / 生成中）时不插队打断；书没绑定或指纹对不上也不动', async () => {
    const b = await bound()
    useStudyStore.setState({ running: { kit: false, quiz: false, ask: true } })
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).not.toHaveBeenCalled()

    useStudyStore.setState({ running: { kit: false, quiz: false, ask: false } })
    await useStudyStore.getState().autoGenerate(mkBook('别的书'))
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
  })

  it('没有可用的章节总结：不调用', async () => {
    const b = await bound({ ...mkBook(), chapters: mkBook().chapters.map((c) => ({ ...c, summary: '' })) })
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
  })

  it('setAuto 持久化到 localStorage', () => {
    useStudyStore.getState().setAuto(false)
    expect(localStorage.getItem('juhua.study.auto')).toBe('off')
    useStudyStore.getState().setAuto(true)
    expect(localStorage.getItem('juhua.study.auto')).toBe('on')
  })
})

describe('问书', () => {
  it('检索相关章节作上下文；回答里的【章节】映射为可跳转的引用', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.askBook.mockResolvedValue('约翰逊提出了杠杆收购方案【第2章】。')
    await useStudyStore.getState().ask(book, '杠杆收购是什么')
    const call = ai.askBook.mock.calls[0]
    expect(call[2]).toContain('【第2章】') // 检索命中第 2 章并带上其总结
    expect(call[2]).toContain('杠杆收购方案')
    expect(call[3]).toBe('') // 首问没有历史
    const turn = useStudyStore.getState().chat[0]
    expect(turn).toMatchObject({ question: '杠杆收购是什么', pending: false, citations: ['c2'] })
  })

  it('带上最近 3 轮成功的对话作历史；失败的轮次不进历史', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.askBook.mockResolvedValueOnce('答1').mockRejectedValueOnce(new Error('boom')).mockResolvedValue('答')
    await useStudyStore.getState().ask(book, '问一')
    await useStudyStore.getState().ask(book, '问二') // 失败
    await useStudyStore.getState().ask(book, '问三')
    const history = ai.askBook.mock.calls[2][3] as string
    expect(history).toContain('Q: 问一')
    expect(history).toContain('A: 答1')
    expect(history).not.toContain('问二')
    expect(useStudyStore.getState().chat[1].error).toBe('boom')
  })

  it('空问题/运行中重复提问被忽略；清空对话；换书后旧回答不会写进新书的对话', async () => {
    const a = mkBook('A')
    await useStudyStore.getState().bind(a)
    await useStudyStore.getState().ask(a, '   ')
    expect(ai.askBook).not.toHaveBeenCalled()

    let release!: () => void
    ai.askBook.mockImplementation(() => new Promise((r) => (release = () => r('迟到的回答'))))
    const p = useStudyStore.getState().ask(a, '问')
    await useStudyStore.getState().bind(mkBook('B'))
    release()
    await p
    expect(useStudyStore.getState().chat).toEqual([])
    useStudyStore.getState().clearChat()
    expect(useStudyStore.getState().chat).toEqual([])
  })

  it('取消：请求被中止，该轮标记为 aborted，且不留在运行状态', async () => {
    const book = mkBook()
    await useStudyStore.getState().bind(book)
    ai.askBook.mockImplementation(
      (...args: unknown[]) =>
        new Promise((_r, rej) => {
          const signal = (args[args.length - 1] as { signal: AbortSignal }).signal
          signal.addEventListener('abort', () => rej(new Error('x')))
        })
    )
    const p = useStudyStore.getState().ask(book, '问')
    useStudyStore.getState().cancel()
    await p
    expect(useStudyStore.getState().chat[0].error).toBe('aborted')
    expect(useStudyStore.getState().running.ask).toBe(false)
  })
})

describe('阅读深度', () => {
  it('setDepth 持久化到 localStorage', () => {
    useStudyStore.getState().setDepth('points')
    expect(useStudyStore.getState().depth).toBe('points')
    expect(localStorage.getItem('juhua.study.depth')).toBe('points')
  })

  const chapters = mkBook().chapters
  const labels = { terms: '术语' }

  it('full / 无速读包：原样返回；点档与一句话档只替换有速读卡的章节', () => {
    expect(applyDepth(chapters, kit, 'full', labels)).toEqual(chapters)
    expect(applyDepth(chapters, null, 'points', labels)).toEqual(chapters)
    const one = applyDepth(chapters, kit, 'oneliner', labels)
    expect(one[1].summary).toBe('提出方案')
    expect(one[0].summary).toBe(chapters[0].summary) // 没有速读卡的章节保持全文
    const pts = applyDepth(chapters, kit, 'points', labels)
    expect(pts[1].summary).toContain('**提出方案**')
    expect(pts[1].summary).toContain('- p3')
    expect(pts[1].summary).toContain('**术语**')
    expect(pts[1].summary).toContain('- **杠杆收购**：用债务收购')
    expect(chapters[1].summary).toBe('约翰逊提出杠杆收购方案。') // 不改原数据
  })

  it('renderStudyChapter：没有术语时不出现术语标题；kitCoverage 统计覆盖章数', () => {
    expect(renderStudyChapter({ ...kit.chapters[0], terms: [] }, 'points', labels)).not.toContain('术语')
    expect(kitCoverage(chapters, kit)).toEqual({ covered: 1, total: 3 })
    expect(kitCoverage(chapters, null)).toEqual({ covered: 0, total: 3 })
  })
})

describe('autoGenerate 与 bind 的竞态 / 答题记录保护（独立审查 M1、M2）', () => {
  it('重复 bind（StrictMode / 重挂载）时，第二次的 then(autoGenerate) 也要等本机数据读完——不重复生成、不丢答题记录', async () => {
    const b = mkBook()
    const answers = { q1: { picked: 0, correct: true } }
    const slow = memoryBackend({ [studyKeyOf(b)]: { kit, quiz, answers, kitFp: studyKeyOf(b), quizFp: studyKeyOf(b) } })
    studyDeps.backend = { ...slow.backend, load: (k) => new Promise((r) => setTimeout(() => r(slow.db.get(k) ?? null), 30)) }
    const run = () => useStudyStore.getState().bind(b).then(() => useStudyStore.getState().autoGenerate(b))
    await Promise.all([run(), run()])
    expect(ai.generateStudyKit).not.toHaveBeenCalled()
    expect(ai.generateQuiz).not.toHaveBeenCalled()
    expect(useStudyStore.getState().data.answers).toEqual(answers)
  })

  it('过时的自测若已有答题记录：自动生成不碰（重做会清掉记录，留给用户手动）；没有记录才自动重做', async () => {
    const b = mkBook()
    const key = studyKeyOf(b)
    mem = memoryBackend({ [key]: { kit, quiz, answers: { q1: { picked: 0, correct: true } }, kitFp: key, quizFp: 'old-fp' } })
    studyDeps.backend = mem.backend
    await useStudyStore.getState().bind(b)
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateQuiz).not.toHaveBeenCalled()
    expect(useStudyStore.getState().data.answers).toEqual({ q1: { picked: 0, correct: true } })

    // 没有答题记录：照常自动重做
    resetAutoTried()
    mem = memoryBackend({ [key]: { kit, quiz, answers: {}, kitFp: key, quizFp: 'old-fp' } })
    studyDeps.backend = mem.backend
    ai.generateQuiz.mockResolvedValue(quiz)
    useStudyStore.setState({ bookKey: null })
    await useStudyStore.getState().bind(b)
    await useStudyStore.getState().autoGenerate(b)
    expect(ai.generateQuiz).toHaveBeenCalledTimes(1)
  })
})
