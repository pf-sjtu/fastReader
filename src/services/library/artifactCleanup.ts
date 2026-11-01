/**
 * WebDAV 同步目录里「处理产物」的过时判定（纯函数，只分类、不删除）。
 *
 * 两类产物、两套识别方式：
 *   A. 与书同级的旧式文件，靠文件名约定识别（没有清单文件）：
 *      {名}-完整摘要.md          主产物（章节总结 + 综述；头部 HTML 注释带元数据）
 *      {名}-完整摘要.json        关键图表
 *      {名}-完整摘要.meta.json   v3 章节旁路（别名等）
 *      {名}_chapter_N_summary.md / _mindmap.json / _combined_mindmap.json  旧版逐章导出，已被完整摘要取代
 *   B. `.juhua/books/<bookFolder>/<kind>.json.gz` 信封包（docs/artifact-store.md §2、`artifacts/envelope.ts`）：
 *      速读 / 自测 / 笔记各一份，一个包最多三份。
 *
 * 分四种「过时」，处理强度不同：
 *   legacy    旧格式，早已被 -完整摘要.md 取代                             → 建议清理（默认勾选）
 *   dangling  附件（图表 / 旁路）的主 MD 已不存在                          → 建议清理（默认勾选）：没有主 MD 它们读不出来
 *   orphan    书已不在（旧式主 MD 在 / 信封包整包）                        → 仅列出（默认不勾选）：摘要与笔记仍可读，留不留由用户定
 *   stale     书还在，但信封的上游指纹与当前不符（速读 / 自测按旧总结生成）→ 仅列出（默认不勾选）：信封里可能带着用户的答题记录，
 *                                                                            删了不可恢复，只提示，让用户自己确认
 *
 * 绝不涉及：书籍文件本身、`.juhua` 下的索引与封面（`.juhua/books` 的信封包是唯一例外，且整包默认不勾选）、
 * 包内不认识的文件、任何不匹配上述命名的文件。
 * 「读不懂 / 读失败 / schema 更高」一律不动——清理是不可逆删除，宁可漏删，不可误删。
 */
import { GENERATED_ARTIFACT } from './libraryIndex'
import {
  bookKeyOf,
  isInputsStale,
  type ArtifactEnvelope,
  type ArtifactKind as EnvelopeKind,
  type ParsedEnvelope,
} from '@/services/artifacts/envelope'

export type ArtifactKind = 'summary' | 'charts' | 'sidecar' | 'legacy' | 'artifact'
export type StaleReason = 'legacy' | 'dangling' | 'orphan' | 'stale'

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
  /** 默认是否勾选：只有「确定没用」的旧格式与悬空附件；孤儿与已过时一律不勾（信封里可能含用户数据，删了不可恢复） */
  recommended: boolean
  /** 整包（`.juhua/books/<bookFolder>` 目录）：删除走 io.removeDir，不是删单个文件 */
  dir?: boolean
  /** 该包内含笔记（用户亲手写的划线与批注）：界面上要警示，且一律不推荐删除 */
  hasNotes?: boolean
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
/** 信封包内允许存在的文件名（service 用它认 kind）：多出别的文件就整包不动，免得删整包连带删掉看不懂的东西 */
export const ENVELOPE_FILE = /^(study|quiz|notes)\.json\.gz$/

const inDotDir = (path: string, syncPath: string) => {
  const rest = path.startsWith(syncPath) ? path.slice(syncPath.length) : path
  return rest.split('/').some((seg) => seg.startsWith('.'))
}

/** 附件对应的主 MD 文件名：X-完整摘要.json / .meta.json → X-完整摘要.md */
const mainSummaryOf = (basename: string) => basename.replace(/\.meta\.json$/, '.md').replace(/\.json$/, '.md')

/** 同级排序：先按原因，再按文件名。文件项与整包项合并后也用它 */
export const compareStaleArtifacts = (a: StaleArtifact, b: StaleArtifact) =>
  a.reason.localeCompare(b.reason) || a.basename.localeCompare(b.basename)

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
  return out.sort(compareStaleArtifacts)
}

/** 「书还在」的书：WebDAV 真书 ∪ 云端书目里的记录；`studyFp` 用来判定速读 / 自测是否已过时 */
export interface LiveBook {
  title: string
  author?: string
  /** 该书当前「各章总结指纹」；缺省 = 没算过，此时不判过时 */
  studyFp?: string
}

/** 包内一个文件（读由 service 负责，这里只做判定） */
export interface ScannedEnvelopeFile {
  /** 该文件的类型；`null` = 包里多出来的、不认识的文件（此时整包不列） */
  kind: EnvelopeKind | null
  path: string
  basename: string
  size: number
  mtime?: string
  /** `parseEnvelopeText` 的结果；null = 读取失败。读失败 / 结构坏 / schema 更高都当「不认识」 */
  parsed: ParsedEnvelope | null
}

/** `.juhua/books/<bookFolder>` 一个包 */
export interface ScannedPackage {
  /** 包目录的完整路径 */
  path: string
  /** 目录名（bookFolder） */
  folder: string
  files: readonly ScannedEnvelopeFile[]
}

export interface PackageClassifyInput {
  packages: readonly ScannedPackage[]
  liveBooks: readonly LiveBook[]
}

type OkEnvelopeFile = ScannedEnvelopeFile & { parsed: { status: 'ok'; env: ArtifactEnvelope } }

const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')

type Matchers = {
  /** 只认精确 bookKey：指纹（`stale`）判定用它，不能跨书比较 */
  exact: (env: ArtifactEnvelope) => LiveBook | null
  /** 精确键失配时退一步只比书名，但两侧都有非空作者且不同就不认领 */
  loose: (env: ArtifactEnvelope) => LiveBook | null
}

/**
 * 信封 → 对应的书。精确键（`title|author`）优先；云端补全元数据后书名/作者可能变过，精确键会失配，
 * 所以「书还在不在」的判定允许退一步只比书名，但**两侧都有非空作者且不同时绝不退化** ——
 * 否则同书名不同作者会互相认领（书 B 的信封被判成书 A 的，或反过来把 A 的包留在盘上）。
 * 指纹判定只走精确键。
 */
function bookMatcher(liveBooks: readonly LiveBook[]): Matchers {
  const byKey = new Map<string, LiveBook>()
  const byTitle = new Map<string, LiveBook[]>()
  for (const b of liveBooks) {
    const key = bookKeyOf(b)
    if (!byKey.has(key)) byKey.set(key, b)
    const title = normText(b.title)
    if (!title) continue
    const list = byTitle.get(title)
    if (list) list.push(b)
    else byTitle.set(title, [b])
  }
  const exact = (env: ArtifactEnvelope): LiveBook | null => byKey.get(env.bookKey) ?? null
  const loose = (env: ArtifactEnvelope): LiveBook | null => {
    const hit = exact(env)
    if (hit) return hit
    const envAuthor = normText(env.author ?? '')
    for (const b of byTitle.get(normText(env.title)) ?? []) {
      const author = normText(b.author ?? '')
      if (envAuthor && author && envAuthor !== author) continue
      return b
    }
    return null
  }
  return { exact, loose }
}

/**
 * `.juhua/books` 下的信封包：
 * - 包对应的书已不在书库 → 整包 `orphan`（默认不勾选；含笔记时还要警示）；
 * - 书还在，但某份信封的上游指纹与当前不符 → 那一份 `stale`（只列出、不默认勾选，只删这一份，不碰同包的笔记与其它份）。
 *
 * 不列出的情况：包内混有不认识的文件、任何一份读失败 / 结构坏 / schema 更高、书还在但索引里没有 studyFp。
 */
export function classifyStalePackages({ packages, liveBooks }: PackageClassifyInput): StaleArtifact[] {
  const { exact, loose } = bookMatcher(liveBooks)
  const out: StaleArtifact[] = []
  for (const pkg of packages) {
    // 混着不认识的文件：删整包会连带删掉它，整包不动
    if (pkg.files.some((f) => f.kind === null)) continue
    // 任何一份读不懂 / 更高版本：同包的可能与它成套，整包都不动
    if (pkg.files.some((f) => f.parsed?.status !== 'ok')) continue
    const known = pkg.files as readonly OkEnvelopeFile[]
    if (!known.length) continue

    const hasNotes = pkg.files.some((f) => f.kind === 'notes')
    if (known.every((f) => !loose(f.parsed.env))) {
      out.push({
        path: pkg.path,
        basename: pkg.folder,
        size: pkg.files.reduce((n, f) => n + f.size, 0),
        dir: true,
        kind: 'artifact',
        reason: 'orphan',
        recommended: false,
        hasNotes,
      })
      continue
    }

    for (const f of known) {
      // 指纹只认精确 bookKey：同书名不同作者的书各算各的
      const book = exact(f.parsed.env)
      // 笔记是用户亲手写的、没有上游指纹，永不判过时
      if (!book || f.kind === 'notes') continue
      if (!isInputsStale(f.parsed.env.inputsFp, book.studyFp ?? '')) continue
      // 只删这一份信封文件，碰不到同包的笔记与其它份；但信封里带着用户的答题记录，删了不可恢复，所以不默认勾选
      out.push({
        path: f.path,
        basename: `${pkg.folder}/${f.basename}`,
        size: f.size,
        mtime: f.mtime,
        kind: 'artifact',
        reason: 'stale',
        recommended: false,
      })
    }
  }
  return out.sort(compareStaleArtifacts)
}

export interface StaleSummary {
  count: number
  bytes: number
  byReason: Record<StaleReason, { count: number; bytes: number }>
}

export function summarizeStale(list: readonly StaleArtifact[]): StaleSummary {
  const byReason: Record<StaleReason, { count: number; bytes: number }> = {
    legacy: { count: 0, bytes: 0 },
    dangling: { count: 0, bytes: 0 },
    orphan: { count: 0, bytes: 0 },
    stale: { count: 0, bytes: 0 },
  }
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
