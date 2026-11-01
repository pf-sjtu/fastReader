/**
 * 学习功能状态：速读包 / 自测 / 问书。
 * - 数据按书的内容指纹存 IndexedDB；换书（指纹变）先加载再显示，生成结果只写回"发起时的那本书"
 * - AI 调用默认在章节总结稳定后自动补齐速读 / 全书自测（autoGenerate，可在界面关掉），也可手动点击；都可取消；价格未知时界面不估价
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
const AUTO_STORAGE_KEY = 'juhua.study.auto'

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
  /** 章节总结稳定后自动生成速读与全书自测（默认开；各一次调用量级，生成结果按内容指纹缓存，同一本书不会重复生成） */
  auto: boolean
  setAuto: (auto: boolean) => void
  /**
   * 缺什么补什么：先速读（章节悬浮卡要用它），再全书自测。
   * 每本书每种产物本会话只自动试一次——失败 / 被取消不会反复重试烧钱，用户仍可手动点生成。
   * 不打断用户正在进行的操作（生成 / 问书）。
   */
  autoGenerate: (book: Book) => Promise<void>
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

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

let abort: AbortController | null = null
let turnSeq = 0
/** 本会话已自动尝试过的「书指纹:产物」：成功与否都不再自动重来 */
const autoTried = new Set<string>()
/** 仅测试用：清空「已尝试」记录 */
export const resetAutoTried = () => autoTried.clear()

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
    auto: readAuto(),

    setAuto: (auto) => {
      set({ auto })
      try {
        localStorage.setItem(AUTO_STORAGE_KEY, auto ? 'on' : 'off')
      } catch {
        /* 隐私模式 / 配额：仅本次会话生效 */
      }
    },

    autoGenerate: async (book) => {
      const key = get().bookKey
      if (!get().auto || !key || key !== studyKeyOf(book)) return
      if (!usableSummaryChapters(book.chapters).length) return
      const busy = () => Object.values(get().running).some(Boolean)
      for (const kind of ['kit', 'quiz'] as const) {
        const tried = `${key}:${kind}`
        // 书换了 / 用户关掉开关 / 用户正在做别的：停下（下次进入时再看）
        if (get().bookKey !== key || !get().auto || busy()) return
        if (autoTried.has(tried) || (kind === 'kit' ? get().data.kit : get().data.quiz)) continue
        autoTried.add(tried)
        await (kind === 'kit' ? get().generateKit(book) : get().generateQuiz(book))
        // 速读没成功就不接着烧自测：多半是模型 / 网络问题，等用户处理
        if (kind === 'kit' && !get().data.kit) return
      }
    },

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
