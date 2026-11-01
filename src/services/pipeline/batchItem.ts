/**
 * 批量单本处理的辅助步骤：跳过判定、解析、本地缓存、结果上云
 */
import type { ChapterData, EpubProcessor } from '@/services/epubProcessor'
import type { PdfProcessor } from '@/services/pdfProcessor'
import { cloudCacheService } from '@/services/cloudCacheService'
import { metadataFormatter } from '@/services/metadataFormatter'
import { webdavService } from '@/services/webdavService'
import type { ProcessingMode } from '@/types/book'
import { detectBookFormat, getMimeType } from '@/utils/file'
import { isUsableText } from '@/utils/resultStatus'
import { logger } from '@/lib/logger'
import i18n from '@/i18n'
import type { BookPipelineResult, PipelineCache } from './bookPipeline'
import { canHash, fileFingerprint } from './cacheKeys'
import { createLocalPipelineCache, uploadMindMapBundle, type LocalCacheContext } from './persistence'
import { createProcessor, extractionArgs, type ExtractionOptions } from './extract'
import { buildMetaSidecar } from './metaSidecar'

/** 进度文案（i18n，缺键时回退中文默认值） */
export const batchMsg = (key: string, defaultValue: string, vars?: Record<string, unknown>): string =>
  i18n.t(key, { defaultValue, ...vars })

const PHASE_MESSAGES: Partial<Record<string, [string, string]>> = {
  connections: ['batch.progress.connections', '生成章节关联分析...'],
  overall: ['batch.progress.overall', '生成全书总结...'],
  charts: ['batch.progress.charts', '生成关键图表...'],
  combined: ['batch.progress.combined', '生成整书思维导图...'],
}

export function phaseMessage(phase: string): string | null {
  const entry = PHASE_MESSAGES[phase]
  return entry ? batchMsg(entry[0], entry[1]) : null
}

export async function downloadBookData(
  filePath: string
): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  try {
    const result = await webdavService.getFileContents(filePath, 'binary')
    return { success: result.success, data: result.data as ArrayBuffer | undefined, error: result.error }
  } catch (error) {
    logger.error(`[batch] 下载文件失败: ${filePath}`, error)
    return { success: false, error: error instanceof Error ? error.message : '下载文件失败' }
  }
}

export type SkipDecision = 'skip' | 'process' | 'unknown'

/**
 * skipProcessed 判定：
 * - summary：文件名命中（列表或三态复核）后读取 MD 元数据，isPartial=true 不跳过；
 *   读不到元数据按已处理跳过（宁可不覆盖）。webdavService 无 Range，只对命中的书整文件读取
 * - 导图：读 manifest，缺失 / isPartial / 模式不符则处理；状态未知为致命
 */
export async function resolveBatchSkip(
  fileName: string,
  mode: ProcessingMode,
  cachedFileNames?: Set<string>
): Promise<SkipDecision> {
  if (mode !== 'summary') {
    const res = await cloudCacheService.readMindMapManifest(fileName)
    if (res.status === 'unknown') return 'unknown'
    if (res.status === 'missing') return 'process'
    // combined-mindmap 产物包含章节导图，可满足 mindmap 模式
    const modeOk = mode === 'mindmap' || res.manifest.mode === mode
    return modeOk && res.manifest.isPartial !== true ? 'skip' : 'process'
  }
  const listed = !!cachedFileNames && cloudCacheService.isCachedByFileName(fileName, cachedFileNames)
  if (!listed) {
    const status = await cloudCacheService.checkCacheStatus(fileName)
    if (status === 'missing') return 'process'
    if (status === 'unknown') return 'unknown'
  }
  const meta = await cloudCacheService.readCacheMetadata(fileName)
  if (meta.status === 'unknown') {
    logger.warn(`[batch] 读取缓存元数据失败，按已处理跳过: ${fileName}`, meta.error)
    return 'skip'
  }
  return meta.metadata?.isPartial === true ? 'process' : 'skip'
}

/** 解析器按格式动态加载，用完即释放；不支持的格式按纯文本处理 */
export async function extractChaptersFromData(
  fileName: string,
  data: ArrayBuffer,
  options: ExtractionOptions
): Promise<ChapterData[]> {
  const file = new File([data], fileName, { type: getMimeType(fileName) })
  const format = detectBookFormat(file)
  if (!format) {
    return [{ id: '1', title: '全文', content: new TextDecoder('utf-8').decode(data) }]
  }
  const args = extractionArgs(options)
  const processor = await createProcessor(format)
  try {
    if (format === 'epub') {
      const epub = processor as EpubProcessor
      return (await epub.extractBookData(file, ...args)).chapters
    }
    const pdf = processor as PdfProcessor
    return await pdf.extractChapters(file, ...args)
  } finally {
    await processor.destroy()
  }
}

/** 本地版本化缓存：指纹取下载内容（无可靠修改时间，lastModified 记 0） */
export async function createBatchCache(
  data: ArrayBuffer,
  ctx: Omit<LocalCacheContext, 'bookId'>
): Promise<PipelineCache | null> {
  if (!canHash()) return null
  try {
    const bookId = await fileFingerprint({ size: data.byteLength, lastModified: 0, head: data })
    return await createLocalPipelineCache({ ...ctx, bookId })
  } catch (e) {
    logger.warn('[batch] 本地缓存不可用:', e)
    return null
  }
}

export type BatchMetadata = ReturnType<typeof metadataFormatter.generate>

/** 云端 MD 元数据；无分项 usage 时用总 token 按 7:3 近似 */
export function buildBatchMetadata(input: {
  fileName: string
  bookTitle: string
  model: string
  chapterDetectionMode: string
  selectedChapters: number[]
  chapters: ReadonlyArray<{ content: string }>
  result: BookPipelineResult
  totalTokens: number
}): BatchMetadata {
  const { result, totalTokens } = input
  const inputTokens = Math.floor(totalTokens * 0.7)
  return metadataFormatter.generate({
    fileName: input.fileName,
    bookTitle: input.bookTitle,
    model: input.model,
    chapterDetectionMode: input.chapterDetectionMode,
    selectedChapters: input.selectedChapters,
    selectedChapterCount: result.stats.total,
    chapterCount: input.chapters.length,
    originalCharCount: input.chapters.reduce((sum, ch) => sum + ch.content.length, 0),
    processedCharCount:
      result.chapters.reduce((sum, ch) => sum + (isUsableText(ch.summary) ? ch.summary.length : 0), 0) +
      (isUsableText(result.connections) ? result.connections.length : 0) +
      (isUsableText(result.overall) ? result.overall.length : 0),
    skippedChapters: result.stats.skipped,
    isPartial: result.isPartial,
    aiResponseInfo: { inputTokens, outputTokens: Math.max(0, totalTokens - inputTokens) },
  })
}

/** summary：统一 MD（只含可用章节）+ 同名图表 JSON */
export async function saveBatchSummary(
  fileName: string,
  title: string,
  result: BookPipelineResult,
  metadata: BatchMetadata,
  namingMode: 'auto' | 'numbered'
): Promise<{ outputPath: string; content: string }> {
  const content = metadataFormatter.formatUnified(
    {
      title,
      author: '',
      chapters: result.chapters
        .filter((ch) => isUsableText(ch.summary))
        .map((ch) => ({ id: ch.id, title: ch.title, summary: ch.summary ?? '' })),
      overallSummary: result.overall,
      connections: result.connections,
      charts: (result.charts ?? null) as unknown as Record<string, unknown> | null,
    },
    metadata,
    namingMode
  )
  const outputPath = cloudCacheService.getCacheFilePath(fileName)
  const upload = await webdavService.uploadFile(outputPath, content)
  if (!upload.success) throw new Error(upload.error || '上传结果失败')
  if (result.charts) {
    const chartsUp = await cloudCacheService.uploadChartsJson(fileName, result.charts)
    if (!chartsUp.success) logger.warn('[batch] 图表 JSON 上传失败:', chartsUp.error)
  }
  // 序号须与上面写入 MD 的章节顺序一致（同一份过滤结果）
  const sidecar = buildMetaSidecar(result.chapters.filter((ch) => isUsableText(ch.summary)))
  if (sidecar) {
    const metaUp = await cloudCacheService.uploadMetaJson(fileName, sidecar)
    if (!metaUp.success) logger.warn('[batch] 章节旁路上传失败:', metaUp.error)
  }
  return { outputPath, content }
}

/** 导图：沿用单书 syncMindMap 目录布局 + manifest 标记 */
export async function saveBatchMindMaps(
  fileName: string,
  title: string,
  mode: ProcessingMode,
  result: BookPipelineResult,
  info: { chapterCount: number; model: string }
): Promise<{ outputPath: string }> {
  const up = await uploadMindMapBundle(
    { title, author: '', chapters: result.chapters, combinedMindMap: result.combinedMindMap ?? null },
    fileName,
    {
      mode,
      fileName,
      processedAt: new Date().toISOString(),
      model: info.model,
      chapterCount: info.chapterCount,
      processedChapters: result.stats.usable,
      failedChapters: result.stats.failed,
      isPartial: result.isPartial,
    }
  )
  if (!up.success) throw new Error(up.error || '上传导图失败')
  return { outputPath: cloudCacheService.getMindMapManifestPath(fileName) }
}
