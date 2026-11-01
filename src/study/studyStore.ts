/**
 * 学习功能状态：速读包 / 自测 / 问书。
 * - 数据按书的内容指纹存 IndexedDB；换书（指纹变）先加载再显示，生成结果只写回"发起时的那本书"
 * - AI 调用默认在章节总结稳定后自动补齐速读 / 全书自测（autoGenerate，可在界面关掉），也可手动点击；都可取消；价格未知时界面不估价
 * - 问书对话只存内存：不落盘，换书即清空
 */
import { create } from 'zustand'
import { AIService } from '@/services/ai'
import { useConfigStore } from '@/stores/configStore'
import { usableSummaryChapters, promptChapters } from '@/utils/chapterResults'
import { isUsableText } from '@/utils/resultStatus'
import { logger } from '@/lib/logger'
import type { BookSummary } from '@/types/book'
import { retrieveChapters, extractCitations } from './retrieve'
import { idbBackend, emptyStudyData, isPartStale, isStudyStale, mergeStudyData, sanitizeStudyData, staleParts as stalePartsOf, studyEnvelopeFp, studyKeyOf, type StudyBackend, type StudyData, type StudyPart } from './persistence'
import {
  bookKeyOf,
  buildEnvelope,
  isInputsStale,
  loadArtifactResult,
  saveArtifact,
  syncContextFor,
  type ArtifactEnvelope,
  type ArtifactKind,
  type ArtifactLoad,
  type SyncContext,
} from '@/services/artifacts'
import type { ReadingDepth } from './depth'

export const ASK_RETRIEVE_K = 4
export const ASK_HISTORY_TURNS = 3
export const QUIZ_DEFAULT_COUNT = 10
const DEPTH_STORAGE_KEY = 'juhua.study.depth'
const AUTO_STORAGE_KEY = 'juhua.study.auto'
/** 云端写回节流：连点重新生成 / 连答几题不必写几次 WebDAV */
export const STUDY_SYNC_DEBOUNCE_MS = 2000

/** 信封同步的可替换依赖（单测注入内存实现） */
export interface StudyArtifactSync {
  ctx(bookKey: string): SyncContext | null
  /** 读结果要能区分「云端没有」与「读失败」：后者不能拿本机那份去覆盖 */
  load<T>(kind: ArtifactKind, ctx: SyncContext): Promise<ArtifactLoad<T>>
  save<T>(env: ArtifactEnvelope<T>, ctx: SyncContext, known?: ArtifactLoad<unknown> | null): Promise<boolean>
}

const defaultArtifactSync: StudyArtifactSync = {
  ctx: (bookKey) => syncContextFor(bookKey),
  load: loadArtifactResult,
  save: saveArtifact,
}

/** 可替换的外部依赖（单测注入） */
export const studyDeps: { createAI: () => AIService; backend: StudyBackend; artifacts: StudyArtifactSync; now: () => number } = {
  createAI: () => {
    const { aiConfig, aiServiceOptions } = useConfigStore.getState()
    return new AIService(aiConfig, () => useConfigStore.getState().promptConfig, {
      ...aiServiceOptions,
      onTokenUsage: (n: number) => useConfigStore.getState().addTokenUsage(n),
    })
  },
  backend: idbBackend,
  artifacts: defaultArtifactSync,
  now: () => Date.now(),
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

type Book = Pick<BookSummary, 'title' | 'chapters' | 'overallSummary'> & { author?: string }

export type StudySyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'newer'

interface StudyState {
  bookKey: string | null
  data: StudyData
  depth: ReadingDepth
  running: { kit: boolean; quiz: boolean; ask: boolean }
  /** 速读包按批生成的进度 */
  kitProgress: { done: number; total: number } | null
  errors: { kit: string | null; quiz: string | null }
  chat: AskTurn[]
  /** 云端信封同步状态：offline = 没启用 WebDAV / 写失败（本机数据照常，只是没同步上去） */
  sync: StudySyncState
  /** 速读 / 自测是按旧一轮章节总结生成的：生成物还在（不丢东西），但可能已经对不上现在的总结 */
  stale: boolean
  /** 分面板的过时状态：速读面板只看 `kit`，自测面板只看 `quiz`（只重生成一个时另一个不该显得新鲜） */
  staleParts: Record<StudyPart, boolean>
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

/** 当前绑定书的身份：写信封要 bookKey / title / author / 章节数，bind 时记下 */
let bookMeta: { bookKey: string; title: string; author?: string; fp: string; chapterCount: number } | null = null
/** 云端写回的节流定时器：本机立刻落盘，云端攒一会儿 */
let syncTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 本次读到的云端信封。**任何状态都要记住**（含 missing / newer / bad / error）：
 * 写回时据此判断能不能覆盖——读失败或版本更高时一律不写，否则会把别的设备的新副本抹掉。
 */
let remoteKnown: ArtifactLoad<StudyData> | null = null

/** 仅测试用：清掉节流定时器、当前书身份与已读信封 */
export const resetStudySync = () => {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = null
  remoteKnown = null
  bookMeta = null
}

/** 本机有没有值得同步上去的东西（速读 / 自测 / 答题任一） */
function hasStudyContent(data: StudyData): boolean {
  return !!data.kit || !!data.quiz || Object.keys(data.answers).length > 0
}

const language = () => useConfigStore.getState().processingOptions.outputLanguage

export const useStudyStore = create<StudyState>()((set, get) => {
  /**
   * 只在书没换的前提下写回；本机先落盘（离线也要能用），云端交给节流。
   * `kitFp` / `quizFp` 只在刚生成对应那份时跟着 patch 进来，答题记录不带——答题不改变生成物的上游。
   */
  const commit = (key: string, patch: Partial<StudyData>) => {
    if (get().bookKey !== key) return false
    const data: StudyData = { ...get().data, ...patch, updatedAt: studyDeps.now() }
    set({ data, stale: isStudyStale(data, key), staleParts: stalePartsOf(data, key) })
    void studyDeps.backend.save(key, data).catch((e) => logger.warn('[study] 保存失败', e))
    scheduleSync(key)
    return true
  }

  const syncCtx = () => (bookMeta ? studyDeps.artifacts.ctx(bookMeta.bookKey) : null)

  /**
   * 抓到过「不能写回」的状态就返回它：云端版本更高 → 只读；读不懂 / 没读成 → 当云端不可用。
   * 这两种情况都绝不覆盖，否则降级客户端会抹掉新格式，一次网络抖动也会盖掉别的设备的新副本。
   */
  const holdWrite = (): StudySyncState | null => {
    if (!remoteKnown) return null
    if (remoteKnown.status === 'newer') return 'newer'
    if (remoteKnown.status === 'bad' || remoteKnown.status === 'error') return 'offline'
    return null
  }

  const flushSync = async (key: string) => {
    const meta = bookMeta
    if (!meta || get().bookKey !== key) return
    const ctx = syncCtx()
    if (!ctx) return set({ sync: 'offline' })
    const held = holdWrite()
    if (held) return set({ sync: held })
    const data = get().data
    const env = buildEnvelope<StudyData>({
      kind: 'study',
      bookKey: meta.bookKey,
      title: meta.title,
      author: meta.author,
      // 两份都按当前总结做的才写当前指纹；有一份是旧的，就保留旧指纹（清理与别的设备据此判过时）
      inputsFp: studyEnvelopeFp(data, key),
      chapterCount: meta.chapterCount,
      data,
      now: studyDeps.now(),
    })
    const ok = await studyDeps.artifacts.save(env, ctx, remoteKnown)
    if (get().bookKey === key) set({ sync: ok ? 'synced' : 'offline' })
  }

  const scheduleSync = (key: string) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      void flushSync(key)
    }, STUDY_SYNC_DEBOUNCE_MS)
  }

  /**
   * 读云端那份并对齐本机。本机数据先显示（bind 里已经 set 过），这里只做合并：
   * 合并结果与本机不同就刷新界面，与云端不同就排队写回。
   */
  const pullRemote = async (key: string, local: StudyData) => {
    const ctx = syncCtx()
    if (!ctx) return set({ sync: 'offline' })
    set({ sync: 'syncing' })
    const parsed = await studyDeps.artifacts.load<StudyData>('study', ctx)
    // 换书了：这次的结果作废（否则会把 A 书的速读包显示在 B 书上）
    if (get().bookKey !== key) return
    // 任何状态都记住：写回时据此判断能不能覆盖（读失败 / 版本更高 / 读不懂都不许写）
    remoteKnown = parsed
    if (parsed.status === 'missing') {
      // 云端还没有这份存档：本机内容（离线时生成的）推上去，换设备才看得到
      set({ sync: 'idle' })
      if (hasStudyContent(local)) scheduleSync(key)
      return
    }
    if (parsed.status === 'error' || parsed.status === 'bad') return set({ sync: 'offline' })
    if (parsed.status === 'newer') return set({ sync: 'newer' })
    const env = parsed.env
    const sanitized = sanitizeStudyData(env.data)
    const remote: StudyData = {
      ...sanitized,
      // 信封上的指纹是整包的（两份都当前才写当前值）：补给缺指纹的那一份
      ...(sanitized.kit && !sanitized.kitFp ? { kitFp: env.inputsFp || key } : {}),
      ...(sanitized.quiz && !sanitized.quizFp ? { quizFp: env.inputsFp || key } : {}),
      ...(env.updatedAt ? { updatedAt: env.updatedAt } : {}),
    }
    const merged = mergeStudyData(local, remote, { remoteStale: isInputsStale(env.inputsFp, key) })
    if (merged.changedLocal) {
      set({ data: merged.data, stale: isStudyStale(merged.data, key), staleParts: stalePartsOf(merged.data, key) })
      void studyDeps.backend.save(key, merged.data).catch((e) => logger.warn('[study] 保存失败', e))
    }
    set({ sync: 'synced' })
    // 本机有云端没有的东西（比如新答的题）：排一次写回
    if (merged.changedRemote) scheduleSync(key)
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
    sync: 'idle',
    stale: false,
    staleParts: { kit: false, quiz: false },
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
      // 「按旧总结生成」的速读 / 自测视同没有：总结变了就该用新总结重做一次（失败则保留旧的，界面已标注）
      const fresh = (kind: StudyPart) => {
        const d = get().data
        const product = kind === 'kit' ? d.kit : d.quiz
        return !!product && !isPartStale(d, kind, key)
      }
      // 要在动手前一次性问清「哪几份要重做」：重做第一份会把数据里那份的指纹刷成当前值，
      // 之后再问第二份就会被误判成「已经按当前总结做过」（这正是当初漏掉旧自测的原因）。
      const need: Record<StudyPart, boolean> = { kit: !fresh('kit'), quiz: !fresh('quiz') }
      for (const kind of ['kit', 'quiz'] as const) {
        const tried = `${key}:${kind}`
        // 书换了 / 用户关掉开关 / 用户正在做别的：停下（下次进入时再看）
        if (get().bookKey !== key || !get().auto || busy()) return
        if (autoTried.has(tried) || !need[kind]) continue
        autoTried.add(tried)
        await (kind === 'kit' ? get().generateKit(book) : get().generateQuiz(book))
        // 速读没成功就不接着烧自测：多半是模型 / 网络问题，等用户处理
        if (kind === 'kit' && !get().data.kit) return
      }
    },

    bind: async (book) => {
      const key = studyKeyOf(book)
      const nextMeta = {
        bookKey: bookKeyOf(book),
        title: book.title ?? '',
        author: book.author,
        fp: key,
        chapterCount: book.chapters.length,
      }
      const meta = bookMeta
      // 身份先记住：云端读写要靠它，同一本书重复 bind 也要保证它是最新的
      bookMeta = nextMeta
      // 指纹一样但书不一样（章节 id 与总结长度全撞上）时不能早退：那是两本书，信封都不同
      if (get().bookKey === key && meta?.bookKey === nextMeta.bookKey) return
      abort?.abort()
      if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      remoteKnown = null
      // 先切换并清空，再异步加载：避免旧书数据短暂显示在新书上
      set({
        bookKey: key,
        data: emptyStudyData(),
        chat: [],
        running: { kit: false, quiz: false, ask: false },
        kitProgress: null,
        errors: { kit: null, quiz: null },
        sync: 'idle',
        stale: false,
        staleParts: { kit: false, quiz: false },
      })
      const loaded = await studyDeps.backend.load(key).catch(() => null)
      if (get().bookKey !== key) return
      const local: StudyData = loaded ? { ...sanitizeStudyData(loaded) } : emptyStudyData()
      if (loaded) {
        // 本机这份就是按当前指纹存的：哪一份没写指纹（旧数据）就给哪一份补当前指纹，别把它误判成「按旧总结生成」
        if (local.kit && !local.kitFp) local.kitFp = key
        if (local.quiz && !local.quizFp) local.quizFp = key
        set({ data: local, stale: isStudyStale(local, key), staleParts: stalePartsOf(local, key) })
      }
      // 本机数据已经能用了，云端那份只是可能更全 / 更新：异步对齐，不阻塞界面
      await pullRemote(key, get().data)
    },

    generateKit: async (book) => {
      const key = get().bookKey
      if (!key || get().running.kit) return
      const chapters = promptChapters(book.chapters)
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
        commit(key, { kit, kitFp: key })
      } catch (e) {
        if (!signal.aborted && get().bookKey === key) set({ errors: { ...get().errors, kit: e instanceof Error ? e.message : String(e) } })
      } finally {
        if (get().bookKey === key) set({ running: { ...get().running, kit: false }, kitProgress: null })
      }
    },

    generateQuiz: async (book, count = QUIZ_DEFAULT_COUNT, scopeChapterId = null) => {
      const key = get().bookKey
      if (!key || get().running.quiz) return
      const all = promptChapters(book.chapters)
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
        commit(key, { quiz, answers: {}, quizFp: key })
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
      const chapters = promptChapters(book.chapters)
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
