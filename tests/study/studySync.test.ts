/**
 * 速读 / 自测的云端信封同步：本机为准、云端对齐、过时只标注不丢弃。
 * 这里注入内存 ArtifactIO（不经 WebDAV），验证的是「合并与写回」的规则本身。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetAutoTried, resetStudySync, studyDeps, useStudyStore, STUDY_SYNC_DEBOUNCE_MS } from '@/study/studyStore'
import { emptyStudyData, mergeStudyData, studyKeyOf, type StudyBackend, type StudyData } from '@/study/persistence'
import {
  ARTIFACT_SCHEMA,
  artifactPath,
  buildEnvelope,
  loadArtifactResult,
  parseEnvelopeText,
  saveArtifact,
  type ArtifactEntry,
  type ArtifactEnvelope,
  type ArtifactIO,
} from '@/services/artifacts'
import type { Quiz, StudyKit } from '@/study/schema'

const BOOK_KEY = '人类简史|尤瓦尔'
const SYNC_PATH = '/fastReader'

const mkBook = () => ({
  title: '人类简史',
  author: '尤瓦尔',
  overallSummary: '全书总结。',
  chapters: Array.from({ length: 3 }, (_, i) => ({
    id: `c${i + 1}`,
    title: `第${i + 1}章`,
    content: '',
    processed: true,
    summary: `第${i + 1}章的总结`,
  })),
})

const kit: StudyKit = {
  version: 1,
  chapters: [{ chapterId: 'c1', chapterTitle: '第1章', oneLiner: '一句话', points: ['p1'], terms: [] }],
}
const otherKit: StudyKit = {
  version: 1,
  chapters: [{ chapterId: 'c1', chapterTitle: '第1章', oneLiner: '云端那一份', points: ['p2'], terms: [] }],
}
const quiz: Quiz = {
  version: 1,
  questions: [
    { id: 'q1', type: 'choice', question: '谁？', options: ['a', 'b'], answerIndex: 0, explanation: '', chapterId: 'c1', chapterTitle: '第1章' },
    { id: 'q2', type: 'short', question: '为何？', answer: '因为', explanation: '', chapterId: null, chapterTitle: '' },
  ],
}
/** 另一套题（重新生成过）：id 还是 q1 / q2，但内容不同 */
const otherQuiz: Quiz = {
  version: 1,
  questions: [
    { id: 'q1', type: 'choice', question: '换过的题？', options: ['a', 'b'], answerIndex: 1, explanation: '', chapterId: 'c1', chapterTitle: '第1章' },
    { id: 'q2', type: 'short', question: '换过的问？', answer: '新答案', explanation: '', chapterId: null, chapterTitle: '' },
  ],
}

class FakeIO implements ArtifactIO {
  files = new Map<string, string>()
  writes: string[] = []
  throwOnRead = false
  async read(path: string): Promise<string | null> {
    if (this.throwOnRead) throw new Error('boom')
    return this.files.get(path) ?? null
  }
  async write(path: string, text: string): Promise<boolean> {
    this.files.set(path, text)
    this.writes.push(path)
    return true
  }
  async list(): Promise<ArtifactEntry[]> {
    return []
  }
  async removeDir(): Promise<boolean> {
    return true
  }
}

let io: FakeIO
let mem: Map<string, StudyData>
let clock = 1_000

/** 云端已经存着一份信封（envelope 上的 inputsFp 是整包的：两份都当前才是当前值） */
const seedRemote = (data: StudyData, inputsFp: string, updatedAt: number, schema = ARTIFACT_SCHEMA) => {
  const env = buildEnvelope<StudyData>({ kind: 'study', bookKey: BOOK_KEY, title: '人类简史', author: '尤瓦尔', inputsFp, data, now: updatedAt })
  io.files.set(artifactPath(SYNC_PATH, BOOK_KEY, 'study'), JSON.stringify({ ...env, schema }))
}

const readRemote = (): ArtifactEnvelope<StudyData> => {
  const text = io.files.get(artifactPath(SYNC_PATH, BOOK_KEY, 'study'))
  const parsed = text ? parseEnvelopeText<StudyData>(text, 'study') : null
  if (!parsed || parsed.status !== 'ok') throw new Error('云端信封不合法')
  return parsed.env
}

const bind = (book = mkBook()) => useStudyStore.getState().bind(book)
const flush = () => vi.advanceTimersByTimeAsync(STUDY_SYNC_DEBOUNCE_MS)

beforeEach(() => {
  vi.useFakeTimers()
  clock = 1_000
  resetAutoTried()
  resetStudySync()
  io = new FakeIO()
  mem = new Map()
  const backend: StudyBackend = {
    load: async (k) => mem.get(k) ?? null,
    save: async (k, d) => void mem.set(k, d),
    remove: async (k) => void mem.delete(k),
  }
  studyDeps.backend = backend
  studyDeps.artifacts = {
    ctx: (bookKey) => ({ io, syncPath: SYNC_PATH, bookKey }),
    load: loadArtifactResult,
    save: saveArtifact,
  }
  studyDeps.now = () => ++clock
  studyDeps.createAI = () => ({}) as never
  useStudyStore.setState({
    auto: true,
    bookKey: null,
    data: emptyStudyData(),
    chat: [],
    running: { kit: false, quiz: false, ask: false },
    kitProgress: null,
    errors: { kit: null, quiz: null },
    sync: 'idle',
    stale: false,
    staleParts: { kit: false, quiz: false },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mergeStudyData：两边都不丢', () => {
  it('上游没变：较新的那份为主，空缺由另一份补上（两边都会得到补齐）', () => {
    const local: StudyData = { kit, quiz: null, answers: {}, kitFp: 'f', updatedAt: 2000 }
    const remote: StudyData = { kit: null, quiz, answers: {}, quizFp: 'f', updatedAt: 1000 }
    const r = mergeStudyData(local, remote, { remoteStale: false })
    expect(r.data.kit).toEqual(kit)
    expect(r.data.quiz).toEqual(quiz)
    expect(r.data.kitFp).toBe('f')
    expect(r.data.quizFp).toBe('f')
    expect(r.changedLocal).toBe(true) // 本机多了云端那份自测
    expect(r.changedRemote).toBe(true) // 云端多了本机这份速读
  })

  it('云端较新：生成物换成云端的，两边题目相同时答案取并集', () => {
    const local: StudyData = { kit, quiz, answers: { q1: { picked: 0, correct: true } }, kitFp: 'f', quizFp: 'f', updatedAt: 1000 }
    const remote: StudyData = { kit: otherKit, quiz, answers: { q2: { picked: null, correct: false } }, kitFp: 'f', quizFp: 'f', updatedAt: 2000 }
    const r = mergeStudyData(local, remote, { remoteStale: false })
    expect(r.data.kit).toEqual(otherKit)
    expect(r.data.answers).toEqual({ q1: { picked: 0, correct: true }, q2: { picked: null, correct: false } })
  })

  it('两边的自测不是同一套题时，答案只取题目来源那一侧：按位置排的 id 会把旧答案贴到新题上', () => {
    const local: StudyData = { kit: null, quiz, answers: { q1: { picked: 0, correct: true } }, quizFp: 'f', updatedAt: 2000 }
    const remote: StudyData = { kit: null, quiz: otherQuiz, answers: { q1: { picked: 1, correct: true }, q2: { picked: null, correct: false } }, quizFp: 'f', updatedAt: 1000 }
    const r = mergeStudyData(local, remote, { remoteStale: false })
    expect(r.data.quiz).toEqual(quiz) // 本机那份更新，题目以本机为准
    expect(r.data.answers).toEqual({ q1: { picked: 0, correct: true } }) // 云端那套题的作答一律不并进来
  })

  it('云端是按旧总结生成的：内容照收，指纹保持旧值（不冒充「按当前总结生成」）', () => {
    const local = emptyStudyData()
    const remote: StudyData = { kit: otherKit, quiz: null, answers: {}, kitFp: 'study:old', updatedAt: 9000 }
    const r = mergeStudyData(local, remote, { remoteStale: true })
    expect(r.data.kit).toEqual(otherKit)
    expect(r.data.kitFp).toBe('study:old')
  })
})

describe('bind：本机先显示，再与云端对齐', () => {
  it('本机没有、云端有（同一轮总结）：直接采纳，不需要写回', async () => {
    const key = studyKeyOf(mkBook())
    seedRemote({ kit, quiz: null, answers: {}, kitFp: key, updatedAt: 500 }, key, 500)
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().stale).toBe(false)
    expect(useStudyStore.getState().staleParts).toEqual({ kit: false, quiz: false })
    expect(useStudyStore.getState().sync).toBe('synced')
    expect(io.writes).toEqual([])
  })

  it('云端还没有这份存档（离线期间生成的）：本机内容随后推上去，换设备才看得到', async () => {
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz: null, answers: {}, kitFp: key, updatedAt: 500 })
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().sync).toBe('idle')
    await flush()
    expect(readRemote().data.kit).toEqual(kit)
    expect(readRemote().inputsFp).toBe(key)
  })

  it('云端是按旧总结生成的：收下并标注过时，写回时保留旧指纹', async () => {
    seedRemote({ kit, quiz: null, answers: {}, kitFp: 'study:old', updatedAt: 500 }, 'study:old', 500)
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().stale).toBe(true)
    expect(useStudyStore.getState().staleParts).toEqual({ kit: true, quiz: false })

    useStudyStore.getState().resetAnswers() // 任意一次改动触发写回
    await flush()
    expect(readRemote().inputsFp).toBe('study:old')
    expect(readRemote().data.kit).toEqual(kit)
  })

  it('只有一份是按旧总结做的：过时状态按面板分开，整包指纹保留旧的', async () => {
    const key = studyKeyOf(mkBook())
    seedRemote({ kit, quiz, answers: {}, kitFp: key, quizFp: 'study:old' }, 'study:old', 500)
    await bind()
    expect(useStudyStore.getState().stale).toBe(true)
    expect(useStudyStore.getState().staleParts).toEqual({ kit: false, quiz: true })

    useStudyStore.getState().resetAnswers()
    await flush()
    expect(readRemote().inputsFp).toBe('study:old') // 有一份没跟上，就不能冒充当前
  })

  it('两边各有一半：合并后都留着，并把结果写回云端', async () => {
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz: null, answers: {}, kitFp: key, updatedAt: 2000 })
    seedRemote({ kit: null, quiz, answers: {}, quizFp: key, updatedAt: 1000 }, key, 1000)
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().data.quiz).toEqual(quiz)

    await flush()
    expect(readRemote().data.quiz).toEqual(quiz)
    expect(readRemote().data.kit).toEqual(kit)
  })

  it('本机是旧的那一份（同一轮总结）：以云端为准', async () => {
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz: null, answers: {}, kitFp: key, updatedAt: 1000 })
    seedRemote({ kit: otherKit, quiz: null, answers: {}, kitFp: key, updatedAt: 2000 }, key, 2000)
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(otherKit)
  })

  it('没有 WebDAV：本机照常，状态标为 offline', async () => {
    studyDeps.artifacts = { ctx: () => null, load: loadArtifactResult, save: saveArtifact }
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz: null, answers: {}, kitFp: key, updatedAt: 1000 })
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().sync).toBe('offline')
  })

  it('云端读失败（网络抖动）：标 offline，本机内容不许写回去覆盖', async () => {
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz: null, answers: {}, kitFp: key, updatedAt: 1000 })
    io.throwOnRead = true
    await bind()
    expect(useStudyStore.getState().data.kit).toEqual(kit)
    expect(useStudyStore.getState().sync).toBe('offline')

    useStudyStore.getState().resetAnswers()
    await flush()
    expect(io.writes).toEqual([])
  })

  it('云端信封版本更高：只读，任何改动都不写回（降级客户端不能抹掉新格式）', async () => {
    const key = studyKeyOf(mkBook())
    seedRemote({ kit, quiz: null, answers: {}, kitFp: key, updatedAt: 500 }, key, 500, ARTIFACT_SCHEMA + 1)
    await bind()
    expect(useStudyStore.getState().sync).toBe('newer')

    useStudyStore.getState().resetAnswers()
    await flush()
    expect(io.writes).toEqual([])
    // 云端那份还是原样的更高版本（parseEnvelope 对它是 newer，这里直接看原始 JSON）
    const raw = JSON.parse(io.files.get(artifactPath(SYNC_PATH, BOOK_KEY, 'study'))!) as { schema: number }
    expect(raw.schema).toBe(ARTIFACT_SCHEMA + 1)
    expect(useStudyStore.getState().sync).toBe('newer')
  })
})

describe('写回', () => {
  it('刚生成的速读包按当前指纹写信封，且只在节流窗口结束后写一次', async () => {
    studyDeps.createAI = () => ({ generateStudyKit: async () => kit }) as never
    const book = mkBook()
    await bind(book)
    await useStudyStore.getState().generateKit(book)
    expect(io.writes).toEqual([]) // 还在节流窗口里

    await flush()
    expect(io.writes).toHaveLength(1)
    const env = readRemote()
    expect(env.kind).toBe('study')
    expect(env.bookKey).toBe(BOOK_KEY)
    expect(env.inputsFp).toBe(studyKeyOf(book))
    expect(env.data.kit).toEqual(kit)
    expect(env.chapterCount).toBe(3)
  })

  it('答题不改变生成物的指纹：过时标注不会被答题「洗白」', async () => {
    seedRemote({ kit: null, quiz, answers: {}, quizFp: 'study:old', updatedAt: 500 }, 'study:old', 500)
    await bind()
    expect(useStudyStore.getState().data.quiz).toEqual(quiz)
    expect(useStudyStore.getState().stale).toBe(true)

    useStudyStore.getState().recordAnswer('q1', 0, true)
    expect(useStudyStore.getState().data.quizFp).toBe('study:old')
    expect(useStudyStore.getState().stale).toBe(true)
    expect(useStudyStore.getState().staleParts).toEqual({ kit: false, quiz: true })
  })
})

describe('换书不串写', () => {
  const bookBKey = '未来简史|尤瓦尔'
  const mkBookB = () => ({ ...mkBook(), title: '未来简史' })

  it('A 书在节流窗口内换到 B 书：A 的待写被丢弃，绝不落到 B 的信封里', async () => {
    studyDeps.createAI = () => ({ generateStudyKit: async () => kit }) as never
    const a = mkBook()
    await bind(a)
    await useStudyStore.getState().generateKit(a)
    expect(io.writes).toEqual([]) // 还没到节流窗口

    await bind(mkBookB()) // 窗口内换书
    await flush()
    expect(io.writes).toEqual([])
    expect(io.files.has(artifactPath(SYNC_PATH, BOOK_KEY, 'study'))).toBe(false)
    expect(io.files.has(artifactPath(SYNC_PATH, bookBKey, 'study'))).toBe(false)
    // B 书自己什么都没生成，界面也不该显示 A 书的速读包
    expect(useStudyStore.getState().data.kit).toBeNull()
  })

  it('B 书随后生成：只写 B 的目录，内容里没有 A 书的东西', async () => {
    const kitB: StudyKit = { version: 1, chapters: [{ chapterId: 'c1', chapterTitle: '第1章', oneLiner: 'B 的一句话', points: [], terms: [] }] }
    studyDeps.createAI = () => ({ generateStudyKit: async () => kitB }) as never
    await bind(mkBook())
    const b = mkBookB()
    await bind(b)
    await useStudyStore.getState().generateKit(b)
    await flush()

    expect(io.writes).toEqual([artifactPath(SYNC_PATH, bookBKey, 'study')])
    const parsed = parseEnvelopeText<StudyData>(io.files.get(artifactPath(SYNC_PATH, bookBKey, 'study'))!, 'study')
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.env.bookKey).toBe(bookBKey)
    expect(parsed.env.title).toBe('未来简史')
    expect(parsed.env.data.kit).toEqual(kitB)
    expect(io.files.has(artifactPath(SYNC_PATH, BOOK_KEY, 'study'))).toBe(false)
  })
})

describe('autoGenerate：过时的速读 / 自测视同没有', () => {
  it('云端那份是按旧总结生成的：自动用当前总结重做一次', async () => {
    const key = studyKeyOf(mkBook())
    seedRemote({ kit, quiz: null, answers: {}, kitFp: 'study:old', updatedAt: 500 }, 'study:old', 500)
    const generateStudyKit = vi.fn(async () => kit)
    const generateQuiz = vi.fn(async () => quiz)
    studyDeps.createAI = () => ({ generateStudyKit, generateQuiz }) as never

    const book = mkBook()
    await bind(book)
    await useStudyStore.getState().autoGenerate(book)
    expect(generateStudyKit).toHaveBeenCalledTimes(1)
    expect(generateQuiz).toHaveBeenCalledTimes(1)
    expect(useStudyStore.getState().data.kitFp).toBe(key)
    expect(useStudyStore.getState().data.quizFp).toBe(key)
    expect(useStudyStore.getState().stale).toBe(false)
  })

  it('两份都过时：重做完第一份之后，第二份仍要重做（不能在循环里二次判新鲜）', async () => {
    const key = studyKeyOf(mkBook())
    mem.set(key, { kit, quiz, answers: {}, kitFp: 'study:old', quizFp: 'study:old', updatedAt: 500 })
    const generateStudyKit = vi.fn(async () => kit)
    const generateQuiz = vi.fn(async () => quiz)
    studyDeps.createAI = () => ({ generateStudyKit, generateQuiz }) as never

    const book = mkBook()
    await bind(book)
    expect(useStudyStore.getState().staleParts).toEqual({ kit: true, quiz: true })
    await useStudyStore.getState().autoGenerate(book)
    expect(generateStudyKit).toHaveBeenCalledTimes(1)
    expect(generateQuiz).toHaveBeenCalledTimes(1)
    expect(useStudyStore.getState().data.quizFp).toBe(key)
    expect(useStudyStore.getState().stale).toBe(false)
  })
})
