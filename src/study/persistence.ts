/**
 * 学习数据的本地持久化（IndexedDB）。键由书的内容指纹决定：章节总结重新生成后指纹变化，
 * 旧的速读包/自测自动失效，不会拿过期内容对着新总结显示。
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
  return { kit, quiz, answers }
}
