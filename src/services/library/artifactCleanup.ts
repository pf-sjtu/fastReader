/**
 * WebDAV 同步目录里「处理产物」的过时判定（纯函数，只分类、不删除）。
 *
 * 产物与书放在同一同步目录，靠文件名约定识别（没有清单文件）：
 *   {名}-完整摘要.md          主产物（章节总结 + 综述；头部 HTML 注释带元数据）
 *   {名}-完整摘要.json        关键图表
 *   {名}-完整摘要.meta.json   v3 章节旁路（别名等）
 *   {名}_chapter_N_summary.md / _mindmap.json / _combined_mindmap.json  旧版逐章导出，已被完整摘要取代
 *
 * 分三种「过时」，处理强度不同：
 *   legacy    旧格式，早已被 -完整摘要.md 取代            → 建议清理（默认勾选）
 *   dangling  附件（图表 / 旁路）的主 MD 已不存在         → 建议清理（默认勾选）：没有主 MD 它们读不出来
 *   orphan    主 MD 在，但对应的书已不在同步目录和云端书目 → 仅列出（默认不勾选）：应用仍能直接读这份摘要，是否留着由用户定
 * 绝不涉及：书籍文件本身、.juhua 下的索引与封面、任何不匹配上述命名的文件。
 */
import { GENERATED_ARTIFACT } from './libraryIndex'

export type ArtifactKind = 'summary' | 'charts' | 'sidecar' | 'legacy'
export type StaleReason = 'legacy' | 'dangling' | 'orphan'

export interface ListedArtifactFile {
  path: string
  basename: string
  size: number
  mtime?: string
}

export interface StaleArtifact {
  path: string
  basename: string
  size: number
  mtime?: string
  kind: ArtifactKind
  reason: StaleReason
  /** 默认是否勾选：只有「确定没用」的两类 */
  recommended: boolean
}

export interface ClassifyInput {
  /** 同步目录下的全部文件（不含书目录里的书） */
  files: readonly ListedArtifactFile[]
  /** 当前所有「还存在」的书对应的摘要文件名集合（io.summaryNameOf(书文件名)）：WebDAV 上的真书 + 云端书目里的书 */
  liveSummaryNames: ReadonlySet<string>
  /** 同步目录（用来排除 .juhua 等） */
  syncPath: string
}

const SUMMARY = /-完整摘要\.md$/
const CHARTS = /-完整摘要\.json$/
const SIDECAR = /-完整摘要\.meta\.json$/
/** 旧版思维导图导出：{名}_chapter_N_mindmap.json / {名}_combined_mindmap.json（后者在书名目录里） */
const LEGACY_MINDMAP = /(_chapter_\d+_mindmap|_combined_mindmap)\.json$/i

const inDotDir = (path: string, syncPath: string) => {
  const rest = path.startsWith(syncPath) ? path.slice(syncPath.length) : path
  return rest.split('/').some((seg) => seg.startsWith('.'))
}

/** 附件对应的主 MD 文件名：X-完整摘要.json / .meta.json → X-完整摘要.md */
const mainSummaryOf = (basename: string) => basename.replace(/\.meta\.json$/, '.md').replace(/\.json$/, '.md')

export function classifyStaleArtifacts({ files, liveSummaryNames, syncPath }: ClassifyInput): StaleArtifact[] {
  const present = new Set(files.map((f) => f.basename))
  const out: StaleArtifact[] = []
  for (const f of files) {
    if (inDotDir(f.path, syncPath)) continue
    const base = { path: f.path, basename: f.basename, size: f.size, mtime: f.mtime }

    if (GENERATED_ARTIFACT.test(f.basename) || LEGACY_MINDMAP.test(f.basename)) {
      out.push({ ...base, kind: 'legacy', reason: 'legacy', recommended: true })
    } else if (SUMMARY.test(f.basename)) {
      // 主 MD：对应的书还在就是现役
      if (!liveSummaryNames.has(f.basename)) out.push({ ...base, kind: 'summary', reason: 'orphan', recommended: false })
    } else if (SIDECAR.test(f.basename) || CHARTS.test(f.basename)) {
      const kind: ArtifactKind = SIDECAR.test(f.basename) ? 'sidecar' : 'charts'
      const main = mainSummaryOf(f.basename)
      if (!present.has(main)) {
        // 主 MD 没了：附件读不出来，纯垃圾
        out.push({ ...base, kind, reason: 'dangling', recommended: true })
      } else if (!liveSummaryNames.has(main)) {
        // 主 MD 在但书不在：随主 MD 一起算 orphan（一并列出、默认不勾选，保持成套）
        out.push({ ...base, kind, reason: 'orphan', recommended: false })
      }
    }
  }
  return out.sort((a, b) => a.reason.localeCompare(b.reason) || a.basename.localeCompare(b.basename))
}

export interface StaleSummary {
  count: number
  bytes: number
  byReason: Record<StaleReason, { count: number; bytes: number }>
}

export function summarizeStale(list: readonly StaleArtifact[]): StaleSummary {
  const byReason = { legacy: { count: 0, bytes: 0 }, dangling: { count: 0, bytes: 0 }, orphan: { count: 0, bytes: 0 } }
  for (const a of list) {
    byReason[a.reason].count++
    byReason[a.reason].bytes += a.size
  }
  return {
    count: list.length,
    bytes: list.reduce((n, a) => n + a.size, 0),
    byReason,
  }
}
