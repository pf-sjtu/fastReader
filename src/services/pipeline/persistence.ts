/**
 * 结果持久化：本地版本化缓存、云端同步、处理历史
 */
import { syncLibraryStatus } from '@/services/library/libraryStore'
import { serializeCharts, deserializeCharts, type BookCharts } from '@/charts'
import type { PromptConfig } from '@/services/ai/types'
import {
  getChapterConnectionsAnalysisPrompt,
  getChapterMindMapPrompt,
  getCombinedMindMapPrompt,
  getFictionChapterSummaryPrompt,
  getKeyChartsPrompt,
  getNonFictionChapterSummaryPrompt,
  getOverallSummaryPrompt,
} from '@/services/prompts'
import { resolveAutoLanguage, type SupportedLanguage } from '@/services/prompts/utils'
import { cacheService as defaultStore, type CacheService } from '@/services/cacheService'
import { autoSyncService } from '@/services/autoSyncService'
import { cloudCacheService } from '@/services/cloudCacheService'
import { webdavService } from '@/services/webdavService'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import { useConfigStore } from '@/stores/configStore'
import type { BookMindMap, BookSummary, ProcessingMode } from '@/types/book'
import { logger } from '@/lib/logger'
import {
  bookPrefix,
  buildEntryKey,
  canHash,
  entryPrefix,
  nameBookId,
  sha256Hex,
  type CacheKind,
} from './cacheKeys'
import type { BookCacheKind, ChapterInput, PipelineCache } from './bookPipeline'

type CacheStore = Pick<CacheService, 'get' | 'set' | 'deleteByPrefix'>

/** auto 时用解析后的实际语言（进入缓存键） */
export function resolveOutputLanguage(lang: SupportedLanguage | undefined): string {
  return !lang || lang === 'auto' ? resolveAutoLanguage() : lang
}

/** 各处理类型实际使用的 prompt 模板（自定义 > 用户配置 > 内置默认） */
export function resolvePromptTemplates(
  promptConfig: Partial<PromptConfig> | null | undefined,
  bookType: 'fiction' | 'non-fiction',
  customPrompt?: string
): Record<CacheKind, string> {
  const pc = promptConfig ?? {}
  const chapterBase =
    bookType === 'fiction'
      ? pc.chapterSummary?.fiction || getFictionChapterSummaryPrompt()
      : pc.chapterSummary?.nonFiction || getNonFictionChapterSummaryPrompt()
  return {
    summary: customPrompt?.trim() ? customPrompt : chapterBase,
    mindmap: pc.mindmap?.chapter || getChapterMindMapPrompt(),
    connections: pc.connectionAnalysis || getChapterConnectionsAnalysisPrompt(),
    overall_summary: pc.overallSummary || getOverallSummaryPrompt(),
    key_charts: getKeyChartsPrompt(),
    combined_mindmap: pc.mindmap?.combined || getCombinedMindMapPrompt(),
  }
}

export interface LocalCacheContext {
  bookId: string
  /** provider + model */
  modelId: string
  outputLanguage: SupportedLanguage | undefined
  bookType: 'fiction' | 'non-fiction'
  promptConfig: Partial<PromptConfig> | null | undefined
  customPrompt?: string
}

/** 版本化本地缓存适配器；不可哈希的环境返回 null（停用缓存） */
export async function createLocalPipelineCache(
  ctx: LocalCacheContext,
  store: CacheStore = defaultStore
): Promise<PipelineCache | null> {
  if (!canHash() || !ctx.bookId) return null
  const language = resolveOutputLanguage(ctx.outputLanguage)
  const templates = resolvePromptTemplates(ctx.promptConfig, ctx.bookType, ctx.customPrompt)
  const promptHashes = new Map<CacheKind, string>()
  for (const [kind, text] of Object.entries(templates) as Array<[CacheKind, string]>) {
    promptHashes.set(kind, await sha256Hex(text))
  }
  const common = (kind: CacheKind) => [ctx.modelId, promptHashes.get(kind), language, ctx.bookType]
  const chapterKey = async (kind: 'summary' | 'mindmap', ch: ChapterInput) =>
    buildEntryKey(ctx.bookId, kind, ch.id, [
      await sha256Hex(`${ch.title}\n${ch.content}`),
      ...common(kind),
    ])
  const bookKey = async (kind: BookCacheKind, input: string) =>
    buildEntryKey(ctx.bookId, kind, '_', [await sha256Hex(input), ...common(kind)])

  return {
    getChapter: async (kind, ch) => store.get(await chapterKey(kind, ch)),
    setChapter: async (kind, ch, value) => {
      await store.set(await chapterKey(kind, ch), value)
    },
    getBook: async (kind, input) => store.get(await bookKey(kind, input)),
    setBook: async (kind, input, value) => {
      await store.set(await bookKey(kind, input), value)
    },
  }
}

/** 清除某章（按章节 id 分组的全部版本） */
export async function clearChapterEntries(
  bookId: string | null,
  kind: 'summary' | 'mindmap',
  chapterId: string,
  store: CacheStore = defaultStore
): Promise<number> {
  return bookId ? store.deleteByPrefix(entryPrefix(bookId, kind, chapterId)) : 0
}

/** 清除某类书级缓存（同时清本书按文件名保存的图表副本） */
export async function clearKindEntries(
  bookId: string | null,
  kind: CacheKind,
  fileNames: ReadonlyArray<string | null | undefined> = [],
  store: CacheStore = defaultStore
): Promise<number> {
  let n = bookId ? await store.deleteByPrefix(entryPrefix(bookId, kind)) : 0
  if (kind === 'key_charts' && canHash()) {
    for (const name of new Set(fileNames.filter((f): f is string => !!f))) {
      n += await store.deleteByPrefix(entryPrefix(await nameBookId(name), 'key_charts'))
    }
  }
  return n
}

/** 清除整书缓存（指纹分组 + 文件名分组） */
export async function clearBookEntries(
  bookId: string | null,
  fileNames: ReadonlyArray<string | null | undefined> = [],
  store: CacheStore = defaultStore
): Promise<number> {
  let n = bookId ? await store.deleteByPrefix(bookPrefix(bookId)) : 0
  if (canHash()) {
    for (const name of new Set(fileNames.filter((f): f is string => !!f))) {
      n += await store.deleteByPrefix(bookPrefix(await nameBookId(name)))
    }
  }
  return n
}

/** 按云端文件名保存的图表副本（云 / 历史加载无本地文件时的兜底来源） */
async function chartsArtifactKey(fileName: string): Promise<string> {
  return `${entryPrefix(await nameBookId(fileName), 'key_charts', '_')}latest`
}

export async function saveChartsArtifact(
  fileName: string | null | undefined,
  charts: BookCharts | null | undefined,
  store: CacheStore = defaultStore
): Promise<void> {
  if (!fileName || !charts || !canHash()) return
  await store.set(await chartsArtifactKey(fileName), serializeCharts(charts))
}

export async function readChartsArtifact(
  fileName: string | null | undefined,
  store: CacheStore = defaultStore
): Promise<BookCharts | null> {
  if (!fileName || !canHash()) return null
  const raw = await store.get<string>(await chartsArtifactKey(fileName))
  return typeof raw === 'string' ? deserializeCharts(raw) : null
}

export interface SummarySyncOutcome {
  /** MD 同步抛错（autoSync 关闭返回 false 不算失败，与旧行为一致） */
  mdFailed: boolean
  /** 图表 JSON 未保存原因；null 表示无需保存或已保存 */
  chartsError: string | null
}

/**
 * 单书 summary 结果上云：MD 受 autoSync 开关控制；图表 JSON 在 WebDAV 开启时强制落盘
 */
export async function syncSummaryResult(
  summary: BookSummary,
  fileName: string,
  namingMode: 'auto' | 'numbered',
  opts: { webdavEnabled: boolean; hasUsableChapters: boolean }
): Promise<SummarySyncOutcome> {
  const outcome: SummarySyncOutcome = { mdFailed: false, chartsError: null }
  if (opts.hasUsableChapters) {
    try {
      await autoSyncService.syncSummary(summary, fileName, namingMode)
    } catch (e) {
      logger.error('[persistence] 自动同步失败:', e)
      outcome.mdFailed = true
    }
  }
  if (summary.charts && opts.webdavEnabled) {
    try {
      const saved = await autoSyncService.syncChartsJson(fileName, summary.charts)
      if (!saved.success) outcome.chartsError = saved.error || 'unknown'
    } catch (e) {
      outcome.chartsError = e instanceof Error ? e.message : String(e)
    }
  }
  return outcome
}

/**
 * 单书导图结果上云（autoSync 控制）；返回是否失败。
 * 传入 manifest 时，在导图真正上传成功后补写「已处理」标记，使批量 skipProcessed 能识别单书产物
 */
export async function syncMindMapResult(
  mindMap: BookMindMap,
  fileName: string,
  manifest?: MindMapManifest
): Promise<boolean> {
  try {
    const ok = await autoSyncService.syncMindMap(mindMap, fileName.replace(/\.[^/.]+$/, ''))
    if (!ok) return true
    // autoSync 关闭时 syncMindMap 也返回 true 但并未上传，此时不能写标记
    const { enabled, autoSync } = useConfigStore.getState().webdavConfig
    if (manifest && enabled && autoSync) {
      const up = await webdavService.uploadFile(
        cloudCacheService.getMindMapManifestPath(fileName),
        JSON.stringify(manifest, null, 2)
      )
      if (!up.success) return true
    }
    return false
  } catch (e) {
    logger.error('[persistence] 导图同步失败:', e)
    return true
  }
}

export interface MindMapManifest {
  mode: ProcessingMode
  fileName: string
  processedAt: string
  model: string
  chapterCount: number
  processedChapters: number
  failedChapters: number
  isPartial: boolean
}

/**
 * 批量导图上云（不受 autoSync 控制）：沿用单书 syncMindMap 的目录布局，
 * 另写 manifest 作为「已处理」标记（统一摘要 MD 不承载导图）
 */
export async function uploadMindMapBundle(
  mindMap: BookMindMap,
  fileName: string,
  manifest: MindMapManifest
): Promise<{ success: boolean; error?: string }> {
  const base = fileName.replace(/\.[^/.]+$/, '')
  const files: Array<{ name: string; content: string; path: string }> = []
  mindMap.chapters.forEach((ch, index) => {
    if (!ch.mindMap) return
    const name = `${base}_chapter_${index + 1}_mindmap.json`
    files.push({ name, content: JSON.stringify(ch.mindMap, null, 2), path: `${base}/mindmaps/${name}` })
  })
  if (mindMap.combinedMindMap) {
    const name = `${base}_combined_mindmap.json`
    files.push({ name, content: JSON.stringify(mindMap.combinedMindMap, null, 2), path: `${base}/${name}` })
  }
  // manifest 最后写：只有导图文件都写成功才落「已处理」标记
  const sync = await webdavService.syncFiles(files)
  if (!sync.success) return { success: false, error: sync.error }
  const up = await webdavService.uploadFile(
    cloudCacheService.getMindMapManifestPath(fileName),
    JSON.stringify(manifest, null, 2)
  )
  return up.success ? { success: true } : { success: false, error: up.error }
}

export function recordHistory(entry: {
  bookTitle: string
  fileName: string
  processingMode: ProcessingMode
  model: string
  chapterCount: number
}): void {
  try {
    useProcessingHistoryStore.getState().addRecord(entry)
    // 书库状态与历史同一处更新：处理完成即标为已处理（失败静默，下次扫描会校正）
    syncLibraryStatus(entry.fileName, 'done')
  } catch (e) {
    logger.error('[persistence] 记录处理历史失败:', e)
  }
}

