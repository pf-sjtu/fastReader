/**
 * 云端统一摘要 MD → BookSummary（云缓存加载与历史记录加载共用）
 */
import { deserializeCharts, type BookCharts } from '@/charts'
import { cloudCacheService, type ProcessingMetadata } from '@/services/cloudCacheService'
import type { BookSummary, ProcessingMode } from '@/types/book'
import { isPartialCache, toLoadedChapters } from '@/utils/chapterResults'
import { isUsableText } from '@/utils/resultStatus'
import { logger } from '@/lib/logger'
import { readChartsArtifact, recordHistory, saveChartsArtifact } from './persistence'
import { applyMetaSidecar, parseMetaSidecar, type MetaSidecar } from './metaSidecar'

export interface CloudSnapshot {
  content: string
  metadata?: ProcessingMetadata | null
  chartsJson?: string | null
  chartsFileFound?: boolean
  /** 章节旁路 JSON 原文；undefined = 尚未读取（buildCloudBook 会现读），null = 确认没有 */
  metaJson?: string | null
}

export type CloudLoadNotice = 'chartsParseFailed' | 'partial'

export interface LoadedCloudBook {
  summary: BookSummary
  partial: boolean
  chartsJson: string | null
  chartsFileFound: boolean
  chapterCount: number
  /** 缺图表且缓存完整：可自动补生成 */
  autoCharts: boolean
  notices: CloudLoadNotice[]
  metadata: ProcessingMetadata | null
}

/** 关键图表来源优先级：同名 JSON → MD 内嵌 → 本地副本 */
export async function resolveCloudCharts(
  parsedCharts: Record<string, unknown> | null,
  chartsJson: string | null | undefined,
  fileName: string | null | undefined
): Promise<BookCharts | null> {
  if (chartsJson?.trim()) {
    const fromJson = deserializeCharts(chartsJson)
    if (fromJson) return fromJson
    logger.warn('[cloudLoad] 云端图表 JSON 解析失败，尝试 MD 内嵌')
  }
  if (parsedCharts) {
    const fromMd = deserializeCharts(JSON.stringify(parsedCharts))
    if (fromMd) return fromMd
  }
  try {
    return await readChartsArtifact(fileName)
  } catch (e) {
    logger.warn('[cloudLoad] 读取本地图表副本失败:', e)
    return null
  }
}

/** 现场再读一次同名 JSON（不依赖检查阶段可能过期的状态）；失败沿用快照 */
export async function refreshChartsJson(
  fileName: string,
  snapshot: CloudSnapshot
): Promise<CloudSnapshot> {
  try {
    const fresh = await cloudCacheService.readChartsJson(fileName)
    return {
      ...snapshot,
      chartsFileFound: fresh.found || !!snapshot.chartsFileFound,
      chartsJson: fresh.found && fresh.content?.trim() ? fresh.content : snapshot.chartsJson,
    }
  } catch (e) {
    logger.warn('[cloudLoad] 再读图表 JSON 失败:', e)
    return snapshot
  }
}

/** 读章节旁路（别名等）：缺失 / 读失败 / 损坏都当作没有，不影响加载 */
async function loadMetaSidecar(snapshot: CloudSnapshot, fileName: string | null): Promise<MetaSidecar | null> {
  try {
    const text = snapshot.metaJson !== undefined ? snapshot.metaJson : fileName ? await cloudCacheService.readMetaJson(fileName) : null
    return parseMetaSidecar(text)
  } catch (e) {
    logger.warn('[cloudLoad] 读取章节旁路失败:', e)
    return null
  }
}

/** 解析云端快照；无章节且无全书总结时返回 null（视为解析失败） */
export async function buildCloudBook(
  snapshot: CloudSnapshot,
  opts: { fileName: string | null; fallbackTitle: string; idPrefix: string }
): Promise<LoadedCloudBook | null> {
  const parsed = cloudCacheService.parseUnifiedContent(snapshot.content)
  if (!parsed.chapters.length && !parsed.overallSummary) return null

  const metadata = snapshot.metadata ?? parsed.metadata ?? null
  const charts = await resolveCloudCharts(parsed.charts, snapshot.chartsJson, opts.fileName)
  const sidecar = await loadMetaSidecar(snapshot, opts.fileName)
  const summary: BookSummary = {
    title: parsed.title || opts.fallbackTitle,
    author: parsed.author || '',
    chapters: applyMetaSidecar(toLoadedChapters(parsed.chapters, opts.idPrefix), sidecar),
    connections: parsed.connections,
    overallSummary: parsed.overallSummary,
    charts,
    chartsError: null,
  }
  const partial = isPartialCache({ metadata, ...summary })
  const chartsFileFound = !!snapshot.chartsFileFound
  const notices: CloudLoadNotice[] = []
  // JSON 文件在但解析失败：不自动重跑，避免覆盖好文件
  if (!charts && chartsFileFound) notices.push('chartsParseFailed')
  if (partial) notices.push('partial')

  return {
    summary,
    partial,
    chartsJson: snapshot.chartsJson ?? null,
    chartsFileFound,
    chapterCount: parsed.chapters.length,
    autoCharts:
      !charts &&
      !chartsFileFound &&
      !partial &&
      isUsableText(summary.overallSummary) &&
      summary.chapters.length > 0,
    notices,
    metadata,
  }
}

/** 加载后的本地落盘：图表副本 + 处理历史（移到最顶部） */
export async function persistLoadedBook(
  loaded: LoadedCloudBook,
  ctx: { fileName: string | null; mode: ProcessingMode; fallbackModel: string }
): Promise<void> {
  if (!ctx.fileName) return
  try {
    await saveChartsArtifact(ctx.fileName, loaded.summary.charts)
  } catch (e) {
    logger.warn('[cloudLoad] 保存本地图表副本失败:', e)
  }
  recordHistory({
    bookTitle: loaded.summary.title,
    fileName: ctx.fileName,
    processingMode: ctx.mode,
    model: loaded.metadata?.model || ctx.fallbackModel,
    chapterCount: loaded.chapterCount,
  })
}
