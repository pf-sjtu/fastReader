/**
 * 书库索引的纯逻辑：迁移 / 合并 / 扫描比对 / 失效 / GC / 体积上限。
 * 不做任何 IO（读写 WebDAV 与 IndexedDB 在 libraryStore），便于单测覆盖生命周期规则。
 */
import {
  LIBRARY_MAX_BYTES,
  LIBRARY_SCHEMA_VERSION,
  MISSING_SCANS_BEFORE_GC,
  type BookStatus,
  type LibraryEntry,
  type LibraryIndex,
  type ScannedFile,
} from './types'

export const emptyIndex = (now = Date.now()): LibraryIndex => ({
  schemaVersion: LIBRARY_SCHEMA_VERSION,
  updatedAt: now,
  entries: {},
})

/**
 * 处理过程产出的文本文件（不是书）：旧版导出的逐章总结 `{书名}_chapter_N_summary.md` 等。
 * 它们和书放在同一同步目录里，不排除的话会把真书淹没，还会被当成「待补全元数据」。
 */
export const GENERATED_ARTIFACT = /_chapter_\d+_(summary|mindmap)\.(md|txt)$/i

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function titleFromPath(path: string): string {
  return baseName(path).replace(/\.[^/.]+$/, '')
}

/**
 * 「书名 - 作者.epub」是电子书库最常见的命名：不下载就能给书架一个干净的书名和作者。
 * 只对 epub/pdf 生效（md/txt 的「 - 」多半只是标题里的破折号）；真正的元数据补全会覆盖它。
 */
export function parseFileName(path: string): { title: string; author?: string } {
  const stem = titleFromPath(path)
  if (!/\.(epub|pdf)$/i.test(path)) return { title: stem }
  const i = stem.lastIndexOf(' - ')
  if (i <= 0 || i + 3 >= stem.length) return { title: stem }
  return { title: stem.slice(0, i).trim(), author: stem.slice(i + 3).trim() }
}

const STATUSES: readonly BookStatus[] = ['unprocessed', 'partial', 'done']

/** 把磁盘/网络上的任意值收敛成合法条目；缺关键字段则丢弃 */
function sanitizeEntry(raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || !r.path) return null
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const progress = r.readProgress as Record<string, unknown> | undefined
  return {
    path: r.path,
    size: num(r.size),
    mtime: typeof r.mtime === 'string' ? r.mtime : '',
    etag: typeof r.etag === 'string' ? r.etag : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : titleFromPath(r.path),
    author: typeof r.author === 'string' ? r.author : undefined,
    chapterCount: typeof r.chapterCount === 'number' ? r.chapterCount : undefined,
    wordCount: typeof r.wordCount === 'number' ? r.wordCount : undefined,
    pages: typeof r.pages === 'number' ? r.pages : undefined,
    coverKey: typeof r.coverKey === 'string' ? r.coverKey : undefined,
    status: STATUSES.includes(r.status as BookStatus) ? (r.status as BookStatus) : 'unprocessed',
    summaryFile: typeof r.summaryFile === 'string' ? r.summaryFile : undefined,
    // 空串当「没有」：空指纹没法做比对，留着只会让人误以为算过
    studyFp: typeof r.studyFp === 'string' && r.studyFp ? r.studyFp : undefined,
    stale: r.stale === true,
    missingScans: Math.max(0, Math.floor(num(r.missingScans))),
    lastOpenedAt: typeof r.lastOpenedAt === 'number' ? r.lastOpenedAt : undefined,
    readProgress:
      progress && typeof progress.chapterId === 'string' && typeof progress.pct === 'number'
        ? { chapterId: progress.chapterId, pct: Math.min(100, Math.max(0, progress.pct)) }
        : undefined,
    updatedAt: num(r.updatedAt),
  }
}

/**
 * 读入任意 JSON：版本匹配则逐条清洗；版本缺失/更高/结构坏了返回 null，
 * 由调用方走"重建"（重新扫描），而不是带着无法理解的数据继续跑。
 */
export function migrateIndex(raw: unknown): LibraryIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== LIBRARY_SCHEMA_VERSION) return null
  if (!r.entries || typeof r.entries !== 'object' || Array.isArray(r.entries)) return null
  const entries: Record<string, LibraryEntry> = {}
  for (const v of Object.values(r.entries as Record<string, unknown>)) {
    const e = sanitizeEntry(v)
    if (e) entries[e.path] = e
  }
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    entries,
  }
}

/** 按条目的 updatedAt 合并两份索引（WebDAV 没有 CAS：写前重读 + 条目级合并，偶发覆盖可接受） */
export function mergeIndexes(a: LibraryIndex, b: LibraryIndex): LibraryIndex {
  const entries: Record<string, LibraryEntry> = { ...a.entries }
  for (const [path, e] of Object.entries(b.entries)) {
    const cur = entries[path]
    if (!cur || e.updatedAt > cur.updatedAt) entries[path] = e
  }
  return { schemaVersion: LIBRARY_SCHEMA_VERSION, updatedAt: Math.max(a.updatedAt, b.updatedAt), entries }
}

export interface ScanOptions {
  now: number
  /** 源文件名 → 对应的摘要文件名（与 cloudCacheService 的命名规则一致） */
  summaryNameOf: (fileName: string) => string
  /** 同步目录里实际存在的文件名集合，用来判断是否已有摘要 */
  summaryNames: ReadonlySet<string>
}

export interface ScanResult {
  index: LibraryIndex
  added: string[]
  changed: string[]
  removed: string[]
}

const sourceChanged = (e: LibraryEntry, f: ScannedFile): boolean =>
  e.size !== f.size || e.mtime !== f.mtime || (!!f.etag && !!e.etag && e.etag !== f.etag)

/**
 * 用一次成功的目录扫描更新索引：
 * - 新文件：建条目（stale，等待懒补全）
 * - size/mtime/etag 变了：标 stale（元数据重新提取），已读进度保留
 * - 本次没看到：missingScans+1，连续 MISSING_SCANS_BEFORE_GC 次才删除
 * 调用方必须只在扫描**成功**时调用；扫描失败（网络错误）不能当作"所有文件都没了"。
 */
export function applyScan(index: LibraryIndex, files: ScannedFile[], opts: ScanOptions): ScanResult {
  const entries: Record<string, LibraryEntry> = {}
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  const seen = new Set<string>()

  for (const f of files) {
    seen.add(f.path)
    const prev = index.entries[f.path]
    const summary = opts.summaryNameOf(baseName(f.path))
    const hasSummary = opts.summaryNames.has(summary)
    // 扫描只能知道"有没有摘要文件"；是否只有部分章节要打开后才知道，已记为 partial 的不降级
    const status: BookStatus = !hasSummary ? 'unprocessed' : prev?.status === 'partial' ? 'partial' : 'done'
    const summaryFile = hasSummary ? summary : undefined

    if (!prev) {
      added.push(f.path)
      entries[f.path] = {
        path: f.path,
        size: f.size,
        mtime: f.mtime,
        etag: f.etag,
        ...parseFileName(f.path),
        status,
        summaryFile,
        stale: true,
        missingScans: 0,
        updatedAt: opts.now,
      }
      continue
    }

    const isChanged = sourceChanged(prev, f)
    if (isChanged) changed.push(f.path)
    const next: LibraryEntry = {
      ...prev,
      size: f.size,
      mtime: f.mtime,
      etag: f.etag ?? prev.etag,
      status,
      summaryFile,
      stale: prev.stale || isChanged,
      missingScans: 0,
    }
    const touched = isChanged || prev.status !== status || prev.summaryFile !== summaryFile || prev.missingScans !== 0
    entries[f.path] = touched ? { ...next, updatedAt: opts.now } : next
  }

  for (const [path, e] of Object.entries(index.entries)) {
    if (seen.has(path)) continue
    const missingScans = e.missingScans + 1
    // 已识别为处理产物的旧条目（早期版本把它们当书收录过）不必等两轮扫描，直接清掉
    if (missingScans >= MISSING_SCANS_BEFORE_GC || GENERATED_ARTIFACT.test(baseName(path))) removed.push(path)
    else entries[path] = { ...e, missingScans, updatedAt: opts.now }
  }

  return { index: { schemaVersion: LIBRARY_SCHEMA_VERSION, updatedAt: opts.now, entries }, added, changed, removed }
}

/** 局部更新一个条目（打开、补全元数据、进度、状态同步都走这里）；条目不存在时原样返回 */
export function patchEntry(
  index: LibraryIndex,
  path: string,
  patch: Partial<Omit<LibraryEntry, 'path'>>,
  now: number
): LibraryIndex {
  const cur = index.entries[path]
  if (!cur) return index
  return {
    ...index,
    updatedAt: now,
    entries: { ...index.entries, [path]: { ...cur, ...patch, updatedAt: now } },
  }
}

/** 处理完成/清缓存/删摘要时调用：状态与摘要文件名在同一次更新里改，不留中间态 */
export function setStatus(
  index: LibraryIndex,
  path: string,
  status: BookStatus,
  summaryFile: string | undefined,
  now: number
): LibraryIndex {
  return patchEntry(index, path, { status, summaryFile: status === 'unprocessed' ? undefined : summaryFile }, now)
}

/** 序列化后超过上限时，淘汰"最近没打开、也没更新"的条目，直到放得下（至少保留一条） */
export function enforceSizeCap(index: LibraryIndex, maxBytes = LIBRARY_MAX_BYTES): { index: LibraryIndex; evicted: string[] } {
  const sizeOf = (i: LibraryIndex) => new TextEncoder().encode(JSON.stringify(i)).length
  if (sizeOf(index) <= maxBytes) return { index, evicted: [] }
  const recency = (e: LibraryEntry) => Math.max(e.lastOpenedAt ?? 0, e.updatedAt)
  const order = Object.values(index.entries).sort((a, b) => recency(a) - recency(b))
  const entries = { ...index.entries }
  const evicted: string[] = []
  let cur = index
  for (const e of order) {
    if (Object.keys(entries).length <= 1) break
    delete entries[e.path]
    evicted.push(e.path)
    cur = { ...index, entries: { ...entries } }
    if (sizeOf(cur) <= maxBytes) break
  }
  return { index: cur, evicted }
}

export type LibrarySort = 'recent' | 'name' | 'author' | 'status' | 'size' | 'modified' | 'progress' | 'year'
export type LibraryFilter = 'all' | 'done' | 'todo'

const STATUS_RANK: Record<BookStatus, number> = { partial: 0, unprocessed: 1, done: 2 }

/** 搜索范围：书名 / 作者 / 分类 / 出版社 / 年份 / 简介（元数据都用上，找"讲拿破仑的"也能搜到） */
const haystack = (e: LibraryEntry) =>
  [e.title, e.author, e.subjects?.join(' '), e.publisher, e.year, e.desc].filter(Boolean).join(' ').toLowerCase()

export function listEntries(
  index: LibraryIndex,
  { query = '', filter = 'all', sort = 'recent', category = null }: { query?: string; filter?: LibraryFilter; sort?: LibrarySort; category?: string | null } = {}
): LibraryEntry[] {
  const q = query.trim().toLowerCase()
  const list = Object.values(index.entries).filter((e) => {
    if (filter === 'done' && e.status !== 'done') return false
    if (filter === 'todo' && e.status === 'done') return false
    if (category && !e.subjects?.includes(category)) return false
    if (!q) return true
    return haystack(e).includes(q)
  })
  const byName = (a: LibraryEntry, b: LibraryEntry) => a.title.localeCompare(b.title, 'zh')
  const recency = (e: LibraryEntry) => e.lastOpenedAt ?? 0
  // 没有作者的排最后（避免空串排到最前面把有用信息挤下去）
  const byAuthor = (a: LibraryEntry, b: LibraryEntry) =>
    (a.author ? 0 : 1) - (b.author ? 0 : 1) || (a.author ?? '').localeCompare(b.author ?? '', 'zh') || byName(a, b)
  const mtime = (e: LibraryEntry) => (Number.isFinite(Date.parse(e.mtime)) ? Date.parse(e.mtime) : 0)
  const pct = (e: LibraryEntry) => (e.status === 'done' ? 100 : 0) + (e.readProgress?.pct ?? 0)
  if (sort === 'year') return list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byName(a, b)) // 新书在前，没有年份的排最后
  if (sort === 'name') return list.sort(byName)
  if (sort === 'author') return list.sort(byAuthor)
  if (sort === 'size') return list.sort((a, b) => b.size - a.size || byName(a, b))
  if (sort === 'modified') return list.sort((a, b) => mtime(b) - mtime(a) || byName(a, b))
  if (sort === 'progress') return list.sort((a, b) => pct(b) - pct(a) || byName(a, b))
  if (sort === 'status') return list.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b))
  // 最近：打开过的在前（按打开时间），没打开过的按名称
  return list.sort((a, b) => recency(b) - recency(a) || byName(a, b))
}

/** "继续阅读"：打开过且没读完的书，最近的在前 */
export function continueReading(index: LibraryIndex, limit = 4): LibraryEntry[] {
  return Object.values(index.entries)
    .filter((e) => e.lastOpenedAt && e.status !== 'unprocessed' && (e.readProgress?.pct ?? 0) < 100)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, limit)
}
