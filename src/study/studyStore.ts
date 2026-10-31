/**
 * 学习功能状态：速读包 / 自测 / 问书。
 * - 数据按书的内容指纹存 IndexedDB；换书（指纹变）先加载再显示，生成结果只写回"发起时的那本书"
 * - 所有 AI 调用都由用户点击触发（不自动烧钱），可取消；价格未知时界面不估价
 * - 问书对话只存内存：不落盘，换书即清空
 */
import { create } from 'zustand'
import { AIService } from '@/services/ai'
import { useConfigStore } from '@/stores/configStore'
import { usableSummaryChapters } from '@/utils/chapterResults'
import { isUsableText } from '@/utils/resultStatus'
import { logger } from '@/lib/logger'
import type { BookSummary } from '@/types/book'
import { retrieveChapters, extractCitations } from './retrieve'
import { idbBackend, emptyStudyData, sanitizeStudyData, studyKeyOf, type StudyBackend, type StudyData } from './persistence'
import type { ReadingDepth } from './depth'

export const ASK_RETRIEVE_K = 4
export const ASK_HISTORY_TURNS = 3
export const QUIZ_DEFAULT_COUNT = 10
const DEPTH_STORAGE_KEY = 'juhua.study.depth'

/** 可替换的外部依赖（单测注入） */
export const studyDeps: { createAI: () => AIService; backend: StudyBackend } = {
  createAI: () => {
    const { aiConfig, aiServiceOptions } = useConfigStore.getState()
    return new AIService(aiConfig, () => useConfigStore.getState().promptConfig, {
      ...aiServiceOptions,
      onTokenUsage: (n: number) => useConfigStore.getState().addTokenUsage(n),
    })
  },
  backend: idbBackend,
}

export interface AskTurn {
  id: number
  question: string
  answer?: string
  error?: string
  /** 回答里引用的章节 id（已映射到真实章节） */
  citations: string[]
  pending: boolean
}

type Book = Pick<BookSummary, 'title' | 'chapters' | 'overallSummary'>

interface StudyState {
  bookKey: string | null
  data: StudyData
  depth: ReadingDepth
  running: { kit: boolean; quiz: boolean; ask: boolean }
  /** 速读包按批生成的进度 */
  kitProgress: { done: number; total: number } | null
  errors: { kit: string | null; quiz: string | null }
  chat: AskTurn[]

  bind: (book: Book) => Promise<void>
  generateKit: (book: Book, language?: string) => Promise<void>
  /** scopeChapterId 为空 = 全书 */
  generateQuiz: (book: Book, count?: number, scopeChapterId?: string | null) => Promise<void>
  recordAnswer: (questionId: string, picked: number | null, correct: boolean) => void
  resetAnswers: () => void
  ask: (book: Book, question: string) => Promise<void>
  clearChat: () => void
  setDepth: (depth: ReadingDepth) => void
  cancel: () => void
}

function readDepth(): ReadingDepth {
  try {
    const v = localStorage.getItem(DEPTH_STORAGE_KEY)
    return v === 'points' || v === 'oneliner' ? v : 'full'
  } catch {
    return 'full'
  }
}

let abort: AbortController | null = null
let turnSeq = 0

const language = () => useConfigStore.getState().processingOptions.outputLanguage

export const useStudyStore = create<StudyState>()((set, get) => {
  /** 只在书没换的前提下写回；同时落盘 */
  const commit = (key: string, patch: Partial<StudyData>) => {
    if (get().bookKey !== key) return false
    const data = { ...get().data, ...patch }
    set({ data })
    void studyDeps.backend.save(key, data).catch((e) => logger.warn('[study] 保存失败', e))
    return true
  }
  const begin = () => {
    abort?.abort()
    abort = new AbortController()
    return abort.signal
  }

  return {
    bookKey: null,
    data: emptyStudyData(),
    depth: readDepth(),
    running: { kit: false, quiz: false, ask: false },
    kitProgress: null,
    errors: { kit: null, quiz: null },
    chat: [],

    bind: async (book) => {
      const key = studyKeyOf(book)
      if (get().bookKey === key) return
      abort?.abort()
      // 先切换并清空，再异步加载：避免旧书数据短暂显示在新书上
      set({ bookKey: key, data: emptyStudyData(), chat: [], running: { kit: false, quiz: false, ask: false }, kitProgress: null, errors: { kit: null, quiz: null } })
      const loaded = await studyDeps.backend.load(key).catch(() => null)
      if (get().bookKey === key && loaded) set({ data: sanitizeStudyData(loaded) })
    },

    generateKit: async (book) => {
      const key = get().bookKey
      if (!key || get().running.kit) return
      const chapters = usableSummaryChapters(book.chapters)
      if (!chapters.length) {
        set({ errors: { ...get().errors, kit: 'noChapters' } })
        return
      }
      const signal = begin()
      set({ running: { ...get().running, kit: true }, errors: { ...get().errors, kit: null }, kitProgress: { done: 0, total: 1 } })
      try {
        const kit = await studyDeps.createAI().generateStudyKit(book.title || '', chapters, language(), {
          signal,
          onBatch: (done, total) => get().bookKey === key && set({ kitProgress: { done, total } }),
        })
        commit(key, { kit })
      } catch (e) {
        if (!signal.aborted && get().bookKey === key) set({ errors: { ...get().errors, kit: e instanceof Error ? e.message : String(e) } })
      } finally {
        if (get().bookKey === key) set({ running: { ...get().running, kit: false }, kitProgress: null })
      }
    },

    generateQuiz: async (book, count = QUIZ_DEFAULT_COUNT, scopeChapterId = null) => {
      const key = get().bookKey
      if (!key || get().running.quiz) return
      const all = usableSummaryChapters(book.chapters)
      const chapters = scopeChapterId ? all.filter((c) => c.id === scopeChapterId) : all
      if (!chapters.length) {
        set({ errors: { ...get().errors, quiz: 'noChapters' } })
        return
      }
      const signal = begin()
      set({ running: { ...get().running, quiz: true }, errors: { ...get().errors, quiz: null } })
      try {
        const quiz = await studyDeps.createAI().generateQuiz(book.title || '', chapters, count, language(), { signal })
        // 新一轮自测：旧答题记录对不上新题目，一并清掉
        commit(key, { quiz, answers: {} })
      } catch (e) {
        if (!signal.aborted && get().bookKey === key) set({ errors: { ...get().errors, quiz: e instanceof Error ? e.message : String(e) } })
      } finally {
        if (get().bookKey === key) set({ running: { ...get().running, quiz: false } })
      }
    },

    recordAnswer: (questionId, picked, correct) => {
      const key = get().bookKey
      if (!key || get().data.answers[questionId]) return // 同一题只记第一次作答
      commit(key, { answers: { ...get().data.answers, [questionId]: { picked, correct } } })
    },

    resetAnswers: () => {
      const key = get().bookKey
      if (key) commit(key, { answers: {} })
    },

    ask: async (book, question) => {
      const key = get().bookKey
      const q = question.trim()
      if (!key || !q || get().running.ask) return
      const id = ++turnSeq
      const chapters = usableSummaryChapters(book.chapters)
      const refs = chapters.map((c) => ({ id: c.id, title: c.title }))
      const hits = retrieveChapters(q, chapters.map((c) => ({ id: c.id, title: c.title, summary: c.summary ?? '' })), ASK_RETRIEVE_K)
      const context = hits.map((h) => `【${h.title}】\n${h.summary}`).join('\n\n')
      const history = get()
        .chat.filter((t) => t.answer && !t.error)
        .slice(-ASK_HISTORY_TURNS)
        .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
        .join('\n\n')

      const signal = begin()
      set({ chat: [...get().chat, { id, question: q, citations: [], pending: true }], running: { ...get().running, ask: true } })
      const patchTurn = (p: Partial<AskTurn>) =>
        get().bookKey === key && set({ chat: get().chat.map((t) => (t.id === id ? { ...t, ...p, pending: false } : t)) })
      try {
        const answer = await studyDeps
          .createAI()
          .askBook(book.title || '', isUsableText(book.overallSummary) ? book.overallSummary : '', context, history, q, language(), { signal })
        patchTurn({ answer, citations: extractCitations(answer, refs) })
      } catch (e) {
        patchTurn({ error: signal.aborted ? 'aborted' : e instanceof Error ? e.message : String(e) })
      } finally {
        if (get().bookKey === key) set({ running: { ...get().running, ask: false } })
      }
    },

    clearChat: () => set({ chat: [] }),

    setDepth: (depth) => {
      set({ depth })
      try {
        localStorage.setItem(DEPTH_STORAGE_KEY, depth)
      } catch {
        /* 隐私模式 / 配额：仅本次会话生效 */
      }
    },

    cancel: () => {
      abort?.abort()
      abort = null
    },
  }
})
