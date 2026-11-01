/**
 * 学习数据的本地持久化（IndexedDB）。键由书的内容指纹决定：章节总结重新生成后指纹变化，
 * 旧的速读包/自测自动失效，不会拿过期内容对着新总结显示。
 *
 * 速读包与自测**各记自己的上游指纹**（`kitFp` / `quizFp`）：只重新生成其中一个时，
 * 另一个「按旧总结生成」的状态不能跟着被洗白——否则用户拿到的自测与当前总结对不上却没有任何提示。
 */
import { createStore, del, get, set } from 'idb-keyval'
import type { Quiz, StudyKit } from './schema'

export interface AnsweredQuestion {
  /** 选择题选了第几项；简答题为 null */
  picked: number | null
  correct: boolean
}

export interface StudyData {
  kit: StudyKit | null
  quiz: Quiz | null
  answers: Record<string, AnsweredQuestion>
  /** 最近一次改动的毫秒时间戳：跨设备合并时用来判断谁更新（旧数据没有） */
  updatedAt?: number
  /** 速读包是按哪一轮章节总结生成的（`studyKeyOf` 的值）。与当前指纹不同 = 按旧总结生成 */
  kitFp?: string
  /** 自测是按哪一轮章节总结生成的。与 `kitFp` 分开记，见文件头 */
  quizFp?: string
  /** @deprecated 早期版本只有一份指纹（速读与自测共用）。读到就迁移到 `kitFp` / `quizFp`，不再写它 */
  fp?: string
}

export const emptyStudyData = (): StudyData => ({ kit: null, quiz: null, answers: {} })

export interface StudyBackend {
  load(key: string): Promise<StudyData | null>
  save(key: string, data: StudyData): Promise<void>
  remove(key: string): Promise<void>
}

let kv: ReturnType<typeof createStore> | null = null
const store = () => (kv ??= createStore('juhua-study', 'books'))

export const idbBackend: StudyBackend = {
  load: async (key) => (await get<StudyData>(key, store())) ?? null,
  save: async (key, data) => {
    await set(key, data, store())
  },
  remove: async (key) => {
    await del(key, store())
  },
}

/** FNV-1a：书名 + 章节 id 列表 + 各章总结长度。总结变了键就变 */
export function studyKeyOf(book: { title?: string; chapters: readonly { id: string; summary?: string }[] }): string {
  const raw = `${book.title ?? ''}|${book.chapters.map((c) => `${c.id}:${(c.summary ?? '').length}`).join(',')}`
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619)
  return `study:${(h >>> 0).toString(36)}`
}

/** 读到的数据可能来自旧版本或被改坏：只保留结构正确的部分 */
export function sanitizeStudyData(raw: unknown): StudyData {
  const d = (raw ?? {}) as Partial<StudyData>
  const kit = d.kit && d.kit.version === 1 && Array.isArray(d.kit.chapters) ? d.kit : null
  const quiz = d.quiz && d.quiz.version === 1 && Array.isArray(d.quiz.questions) ? d.quiz : null
  const answers: Record<string, AnsweredQuestion> = {}
  if (quiz && d.answers && typeof d.answers === 'object') {
    const ids = new Set(quiz.questions.map((q) => q.id))
    for (const [id, a] of Object.entries(d.answers)) {
      if (ids.has(id) && a && typeof a.correct === 'boolean') answers[id] = { picked: typeof a.picked === 'number' ? a.picked : null, correct: a.correct }
    }
  }
  const kitFp = typeof d.kitFp === 'string' && d.kitFp ? d.kitFp : undefined
  const quizFp = typeof d.quizFp === 'string' && d.quizFp ? d.quizFp : undefined
  // 旧存档只有一份指纹：当时两份是同一轮生成的，有生成物的那边都按它迁移
  const legacyFp = typeof d.fp === 'string' && d.fp ? d.fp : undefined
  const resolvedKitFp = kit ? (kitFp ?? legacyFp) : undefined
  const resolvedQuizFp = quiz ? (quizFp ?? legacyFp) : undefined
  return {
    kit,
    quiz,
    answers,
    ...(typeof d.updatedAt === 'number' ? { updatedAt: d.updatedAt } : {}),
    ...(resolvedKitFp ? { kitFp: resolvedKitFp } : {}),
    ...(resolvedQuizFp ? { quizFp: resolvedQuizFp } : {}),
  }
}

export type StudyPart = 'kit' | 'quiz'

/** 某一份生成物是不是按 `fp` 这一轮总结生成的（没有生成物就谈不上过时） */
export function isPartStale(data: StudyData, part: StudyPart, fp: string): boolean {
  const own = part === 'kit' ? data.kitFp : data.quizFp
  const product = part === 'kit' ? data.kit : data.quiz
  return !!product && !!own && own !== fp
}

/** 速读 / 自测**任一**按旧总结生成（界面据此整体提示；分面板提示用 `staleParts`） */
export const isStudyStale = (data: StudyData, fp: string): boolean =>
  isPartStale(data, 'kit', fp) || isPartStale(data, 'quiz', fp)

/** 哪几份过时：速读面板只看 `kit`，自测面板只看 `quiz` */
export const staleParts = (data: StudyData, fp: string): Record<StudyPart, boolean> => ({
  kit: isPartStale(data, 'kit', fp),
  quiz: isPartStale(data, 'quiz', fp),
})

/**
 * 写进信封的上游指纹：两份都按当前总结做的才写当前指纹；
 * 只要有一份是旧总结做的就保留那份旧指纹——清理侧据此判「已过时」，别的设备也据此提示。
 */
export function studyEnvelopeFp(data: StudyData, currentFp: string): string {
  const parts: string[] = []
  if (data.kit && data.kitFp) parts.push(data.kitFp)
  if (data.quiz && data.quizFp) parts.push(data.quizFp)
  if (!parts.length) return currentFp
  return parts.find((f) => f !== currentFp) ?? currentFp
}

export interface StudyMerge {
  data: StudyData
  /** 合并结果与本机不同：需要刷新界面 + 落盘 */
  changedLocal: boolean
  /** 合并结果与云端那份不同：需要写回云端 */
  changedRemote: boolean
}

const sameStudyData = (a: StudyData, b: StudyData): boolean => JSON.stringify(a) === JSON.stringify(b)

const sameQuiz = (a: Quiz | null, b: Quiz | null): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

/**
 * 合并本机与云端的速读 / 自测数据。
 *
 * 取舍：速读包与自测是花钱生成的，答题记录是用户亲手做的，两边都不能因为「看起来旧」被丢掉。
 * - 上游指纹没变（`remoteStale` 为假）时以较新的一份为主，另一份只补它缺的空缺（缺速读包补速读包，缺自测补自测）；
 * - 云端是按**旧**总结生成的（`remoteStale` 为真）时不当它是新数据，但依然把它的内容收下——本机缺什么就补什么，
 *   由界面标注「按旧总结生成」，用户想更新再点重新生成。
 * - 指纹跟着**各自**生成物的来源走（`base.kit ? base.kitFp : other.kitFp`）：只重生成速读时，
 *   自测仍带着它自己的旧指纹，写回云端后别的设备与清理侧都还看得出它过时。
 * - 答题只在两边是**同一份自测**时按题 id 并集：题目 id 是按位置生成的（q1..qN），
 *   换了卷子还按 id 并集，会把旧答案贴到新卷的「同名」题目上，而界面「同一题只记第一次作答」又让人改不掉。
 */
export function mergeStudyData(local: StudyData, remote: StudyData, opts: { remoteStale: boolean }): StudyMerge {
  const remoteNewer = !opts.remoteStale && (remote.updatedAt ?? 0) > (local.updatedAt ?? 0)
  const base = remoteNewer ? remote : local
  const other = remoteNewer ? local : remote
  const kit = base.kit ?? other.kit
  const quiz = base.quiz ?? other.quiz
  const kitFp = base.kit ? base.kitFp : other.kitFp
  const quizFp = base.quiz ? base.quizFp : other.quizFp
  const updatedAt = Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0)
  const answers = sameQuiz(base.quiz, other.quiz)
    ? { ...other.answers, ...base.answers }
    : { ...(base.quiz ? base.answers : other.answers) }
  const data: StudyData = {
    kit,
    quiz,
    answers,
    ...(updatedAt ? { updatedAt } : {}),
    ...(kitFp ? { kitFp } : {}),
    ...(quizFp ? { quizFp } : {}),
  }
  return { data, changedLocal: !sameStudyData(data, local), changedRemote: !sameStudyData(data, remote) }
}
