/**
 * 整书处理流水线（纯 service，单书 hook 与批量引擎共用）
 *
 * - 章节并行：mapPoolOrdered + signal，结果按章节顺序提交
 * - 先读本地缓存，命中则跳过 AI 调用（进度照常推进）；可用结果写回缓存
 * - 后处理（关联 / 全书总结 / 图表 / 整书导图）只喂 isUsableText 章节，各自容错
 * - 取消：signal 触发后抛 AbortError，不产出结果
 */
import type { MindElixirData } from 'mind-elixir'
import type { BookCharts } from '@/charts'
import type { Chapter, ProcessingMode } from '@/types/book'
import type { AICallOptions } from '@/services/ai/types'
import type { SupportedLanguage } from '@/services/prompts/utils'
import { mapPoolOrdered } from '@/utils/async'
import { prepareChapterInput } from '@/utils/chapterInput'
import { markChapterFailed, usableOrEmpty, usableSummaryChapters } from '@/utils/chapterResults'
import { flattenMindMapToText } from '@/utils/mindMapText'
import { RESULT_PREFIX, failedText, isFailedText, isPlaceholderText, isUsableText } from '@/utils/resultStatus'
import { createAbortError, isAbortError } from '@/utils/runGuard'
import { logger } from '@/lib/logger'
import {
  buildEntityTable,
  checkSummaryQuality,
  joinChapterMeta,
  sanitizeSummary,
  splitChapterMeta,
  type ChapterMeta,
  type QualityIssue,
} from '@/services/prompts/chapterMeta'

export interface ChapterInput {
  id: string
  title: string
  content: string
}

/** 流水线用到的 AI 能力（AIService 的子集，便于测试替身） */
export interface PipelineAI {
  summarizeChapter(
    title: string,
    content: string,
    bookType: 'fiction' | 'non-fiction',
    lang?: SupportedLanguage,
    customPrompt?: string,
    opts?: AICallOptions
  ): Promise<string>
  analyzeConnections(chapters: Chapter[], lang?: SupportedLanguage, opts?: AICallOptions): Promise<string>
  generateOverallSummary(
    title: string,
    chapters: Chapter[],
    connections: string,
    lang?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string>
  generateKeyCharts(
    title: string,
    chapters: Chapter[],
    connections: string,
    overall: string,
    lang?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<BookCharts>
  generateChapterMindMap(
    title: string,
    content: string,
    lang?: SupportedLanguage,
    opts?: AICallOptions,
    bookType?: 'fiction' | 'non-fiction'
  ): Promise<MindElixirData | null>
  generateCombinedMindMap(
    title: string,
    chapters: Chapter[],
    lang?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<MindElixirData | null>
}

export type BookCacheKind = 'connections' | 'overall_summary' | 'key_charts' | 'combined_mindmap'

/** 缓存适配器：键的版本化由实现负责（见 persistence.createLocalPipelineCache） */
export interface PipelineCache {
  getChapter(kind: 'summary' | 'mindmap', chapter: ChapterInput): Promise<unknown>
  setChapter(kind: 'summary' | 'mindmap', chapter: ChapterInput, value: unknown): Promise<void>
  /** input：决定该书级结果的全部输入文本 */
  getBook(kind: BookCacheKind, input: string): Promise<unknown>
  setBook(kind: BookCacheKind, input: string, value: unknown): Promise<void>
}

export type PipelinePhase = 'chapters' | 'connections' | 'overall' | 'charts' | 'combined'
export type PipelineWarning = 'chapters' | 'connections' | 'overall' | 'charts' | 'combined'

export interface RunBookPipelineInput {
  chapters: readonly ChapterInput[]
  mode: ProcessingMode
  ai: PipelineAI
  bookTitle: string
  bookType: 'fiction' | 'non-fiction'
  outputLanguage?: SupportedLanguage
  customPrompt?: string
  concurrency?: number
  signal?: AbortSignal
  cache?: PipelineCache | null
  /** summary 模式是否自动抽取关键图表（默认 true） */
  generateCharts?: boolean
  /** 每次章节 AI 调用后的节流（缓存命中不调用） */
  afterChapterAI?: () => Promise<void>
  onChapterStart?: (chapter: ChapterInput, orderedDone: number, total: number) => void
  /** 章节结果按顺序提交；progress 为 0–100 */
  onChapter?: (chapter: Chapter, index: number, info: { fromCache: boolean; progress: number }) => void
  onPhase?: (phase: PipelinePhase, progress: number) => void
}

export interface BookPipelineResult {
  chapters: Chapter[]
  connections: string
  overall: string
  charts?: BookCharts | null
  chartsError?: string | null
  combinedMindMap?: MindElixirData | null
  warnings: PipelineWarning[]
  isPartial: boolean
  stats: { total: number; usable: number; failed: number; skipped: number; cached: number }
}

/** 章节阶段占进度上限 */
export function chapterPhaseMax(mode: ProcessingMode): number {
  if (mode === 'summary') return 80
  return mode === 'combined-mindmap' ? 85 : 95
}

const isSkippedText = (text?: string) => isPlaceholderText(text) && !isFailedText(text)

function isMindMap(value: unknown): value is MindElixirData {
  return !!value && typeof value === 'object' && 'nodeData' in (value as object)
}

export async function runBookPipeline(input: RunBookPipelineInput): Promise<BookPipelineResult> {
  const { mode, ai, signal, cache, outputLanguage: lang } = input
  const opts: AICallOptions = { signal }
  const total = input.chapters.length
  const phaseMax = chapterPhaseMax(mode)
  const warnings = new Set<PipelineWarning>()
  const throwIfAborted = () => {
    if (signal?.aborted) throw createAbortError()
  }
  const rethrowIfAbort = (err: unknown) => {
    if (signal?.aborted || isAbortError(err)) throw isAbortError(err) ? err : createAbortError()
  }
  /** 缓存读写失败不影响主流程 */
  const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      logger.warn('[pipeline] 缓存访问失败:', e)
      return null
    }
  }

  let orderedDone = 0
  let cached = 0
  const fromCacheFlags = new Array<boolean>(total).fill(false)
  input.onPhase?.('chapters', 0)

  /** 程序化清理 + 质量判定；过短/带问候语时只做一次带说明的定向重写，仍不达标则保留并标 warn */
  const summarizeWithQualityGate = async (
    title: string,
    content: string
  ): Promise<{ summary: string; meta: ChapterMeta | null; warn: boolean }> => {
    const run = async (hint?: string) => {
      const raw = await ai.summarizeChapter(title, content, input.bookType, lang, input.customPrompt, hint ? { ...opts, rewriteHint: hint } : opts)
      const split = splitChapterMeta(raw)
      if (split.metaError) logger.warn(`[pipeline] 「${title}」${split.metaError}`)
      const summary = isUsableText(split.text) ? sanitizeSummary(split.text) : split.text
      const issues = isUsableText(summary)
        ? checkSummaryQuality(summary, content.length, { expectMeta: !input.customPrompt, hasMeta: !!split.meta })
        : []
      return { summary, meta: split.meta, issues }
    }
    const blocking = (issues: QualityIssue[]) => issues.filter((i) => i !== 'noMeta')
    let cur = await run()
    if (blocking(cur.issues).length > 0) {
      const hint = blocking(cur.issues)
        .map((i) => (i === 'tooShort' ? '正文字数不足，须按要求写足篇幅并覆盖本章全部论点' : '开头出现了问候语或说明性文字，必须直接从正文开始'))
        .join('；')
      throwIfAborted()
      const retry = await run(hint)
      if (blocking(retry.issues).length <= blocking(cur.issues).length && retry.summary.length >= cur.summary.length * 0.8) cur = retry
    }
    return { summary: cur.summary, meta: cur.meta, warn: blocking(cur.issues).length > 0 }
  }

  const processChapter = async (chapter: ChapterInput, index: number): Promise<Chapter> => {
    throwIfAborted()
    input.onChapterStart?.(chapter, orderedDone, total)
    const kind = mode === 'summary' ? 'summary' : 'mindmap'
    const hit = cache ? await safe(() => cache.getChapter(kind, chapter)) : null
    throwIfAborted()
    const base = { id: chapter.id, title: chapter.title, content: chapter.content }
    const hitSplit = kind === 'summary' && typeof hit === 'string' ? splitChapterMeta(hit) : null
    if (kind === 'summary' ? isUsableText(hitSplit?.text) : isMindMap(hit)) {
      cached++
      fromCacheFlags[index] = true
      return kind === 'summary'
        ? { ...base, summary: hitSplit!.text, ...(hitSplit!.meta ? { meta: hitSplit!.meta } : {}), processed: true }
        : { ...base, mindMap: hit as MindElixirData, processed: true }
    }
    try {
      const content = prepareChapterInput(chapter.content)
      let result: Chapter
      if (kind === 'summary') {
        const fin = await summarizeWithQualityGate(chapter.title, content)
        throwIfAborted()
        result = { ...base, summary: fin.summary, ...(fin.meta ? { meta: fin.meta } : {}), ...(fin.warn ? { quality: 'warn' as const } : {}), processed: true }
        if (isUsableText(fin.summary) && cache) {
          await safe(() => cache.setChapter(kind, chapter, joinChapterMeta(fin.summary, fin.meta)))
        }
      } else {
        const mindMap = await ai.generateChapterMindMap(chapter.title, content, lang, opts, input.bookType)
        throwIfAborted()
        if (!mindMap) throw new Error('思维导图 JSON 解析失败')
        result = { ...base, mindMap, processed: true }
        if (cache) await safe(() => cache.setChapter(kind, chapter, mindMap))
      }
      await input.afterChapterAI?.()
      return result
    } catch (err) {
      rethrowIfAbort(err)
      logger.error(`[pipeline] 章节失败: ${chapter.title}`, err)
      await input.afterChapterAI?.()
      return markChapterFailed(chapter, err)
    }
  }

  const chapters = await mapPoolOrdered(input.chapters, processChapter, {
    concurrency: input.concurrency,
    signal,
    onOrderedResult: (chapter, index) => {
      orderedDone = index + 1
      const progress = total > 0 ? Math.min(phaseMax, Math.round((orderedDone / total) * phaseMax)) : 0
      input.onChapter?.(chapter, index, { fromCache: fromCacheFlags[index], progress })
    },
  })
  throwIfAborted()

  const failed = chapters.filter((ch) => !ch.processed).length
  const skipped = chapters.filter((ch) => isSkippedText(ch.summary)).length
  if (failed > 0) warnings.add('chapters')

  /** 书级步骤：先查缓存，失败时返回 fallback 并记 warning */
  const bookStep = async <T>(
    kind: BookCacheKind,
    cacheInput: string,
    run: () => Promise<T>,
    usable: (v: unknown) => boolean,
    onFail: (err: unknown) => T
  ): Promise<T> => {
    throwIfAborted()
    const hit = cache ? await safe(() => cache.getBook(kind, cacheInput)) : null
    if (usable(hit)) return hit as T
    throwIfAborted()
    try {
      const value = await run()
      throwIfAborted()
      if (usable(value) && cache) await safe(() => cache.setBook(kind, cacheInput, value))
      return value
    } catch (err) {
      rethrowIfAbort(err)
      logger.error(`[pipeline] ${kind} 失败:`, err)
      return onFail(err)
    }
  }

  const result: BookPipelineResult = {
    chapters,
    connections: '',
    overall: '',
    warnings: [],
    isPartial: false,
    stats: { total, usable: 0, failed, skipped, cached },
  }

  if (mode === 'summary') {
    const usable = usableSummaryChapters(chapters)
    const entityTable = buildEntityTable(chapters.map((c) => c.meta))
    const bookOpts: AICallOptions = entityTable ? { ...opts, entityTable } : opts
    result.stats.usable = usable.length
    result.charts = null
    result.chartsError = null
    if (usable.length > 0) {
      const chapterInput = JSON.stringify(usable.map((c) => [c.id, c.title, c.summary]))
      const usableStr = (v: unknown) => typeof v === 'string' && isUsableText(v)

      input.onPhase?.('connections', 85)
      result.connections = await bookStep(
        'connections', chapterInput,
        () => ai.analyzeConnections(usable, lang, bookOpts),
        usableStr,
        (err) => {
          warnings.add('connections')
          return failedText(RESULT_PREFIX.connectionsFailed, err)
        }
      )
      const connections = usableOrEmpty(result.connections)

      input.onPhase?.('overall', 90)
      result.overall = await bookStep(
        'overall_summary', `${chapterInput}\n${connections}`,
        () => ai.generateOverallSummary(input.bookTitle, usable, connections, lang, bookOpts),
        usableStr,
        (err) => {
          warnings.add('overall')
          return failedText(RESULT_PREFIX.overallFailed, err)
        }
      )

      if (input.generateCharts !== false && isUsableText(result.overall)) {
        const overall = result.overall
        input.onPhase?.('charts', 96)
        result.charts = await bookStep<BookCharts | null>(
          'key_charts', `${chapterInput}\n${connections}\n${overall}`,
          () => ai.generateKeyCharts(input.bookTitle, usable, connections, overall, lang, bookOpts),
          (v) => !!v && typeof v === 'object',
          (err) => {
            warnings.add('charts')
            result.chartsError = err instanceof Error ? err.message : String(err)
            return null
          }
        )
      }
    }
    result.isPartial =
      failed > 0 || skipped > 0 || isFailedText(result.connections) || isFailedText(result.overall)
  } else {
    const forCombined = chapters
      .filter((ch) => ch.processed && ch.mindMap)
      .map((ch) => ({ ...ch, summary: flattenMindMapToText(ch.mindMap) || ch.title }))
    result.stats.usable = forCombined.length
    result.combinedMindMap = null
    let combinedFailed = false
    if (mode === 'combined-mindmap' && forCombined.length > 0) {
      input.onPhase?.('combined', 90)
      result.combinedMindMap = await bookStep<MindElixirData | null>(
        'combined_mindmap',
        JSON.stringify(forCombined.map((c) => [c.id, c.title, c.summary])),
        async () => {
          const map = await ai.generateCombinedMindMap(input.bookTitle, forCombined, lang, opts)
          if (!map) throw new Error('整书思维导图 JSON 解析失败')
          return map
        },
        isMindMap,
        () => {
          warnings.add('combined')
          combinedFailed = true
          return null
        }
      )
    }
    result.isPartial = failed > 0 || combinedFailed
  }

  throwIfAborted()
  result.warnings = [...warnings]
  return result
}
