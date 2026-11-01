/**
 * 书库生命周期编排：镜像（IndexedDB）→ 远端索引（WebDAV）→ 目录扫描 → 合并回写。
 * IO 通过 LibraryIO 注入：生产用 WebDAV + idb-keyval，单测用内存实现。
 *
 * 取舍：
 * - 先读本地镜像再后台刷新（stale-while-revalidate），避免首屏等 WebDAV 的数秒空白
 * - 远端写入"先读后合并再写"：WebDAV 没有 CAS，条目级按 updatedAt 合并，偶发覆盖最多丢一次进度
 * - 扫描失败绝不当作"所有文件都不见了"；GC 只在扫描成功时进行，且需连续两次缺席
 */
import {
  applyScan,
  baseName,
  emptyIndex,
  GENERATED_ARTIFACT,
  enforceSizeCap,
  mergeIndexes,
  migrateIndex,
  patchEntry,
  setStatus,
} from './libraryIndex'
import type { BookStatus, LibraryEntry, LibraryIndex, ScannedFile } from './types'
import { buildNormIndex, isCloudCoverKey, matchCoverId, type CoverIndex } from './cloudCovers'

export interface ListedFile {
  path: string
  basename: string
  size: number
  mtime: string
  etag?: string
}

export interface LibraryIO {
  /** 本次连接的唯一标识（服务器 + 同步目录），镜像按它分开，换账号不串书 */
  scopeKey: string
  syncPath: string
  /** 书所在目录（WebDAV 浏览根）；缺省 = 同步目录。摘要写在 syncPath，书可以在别处 */
  booksPath?: string
  readMirror(): Promise<unknown | null>
  writeMirror(index: LibraryIndex | null): Promise<void>
  /** 远端索引原文：null = 不存在；抛错 = 读取失败（和"不存在"必须区分） */
  readRemote(): Promise<string | null>
  writeRemote(text: string): Promise<void>
  /** 同步目录下所有受支持文件（含摘要 .md）；失败要抛错 */
  listFiles(): Promise<ListedFile[]>
  /** 源文件名 → 摘要文件名（cloudCacheService 的命名规则） */
  summaryNameOf(fileName: string): string
  /** 二进制文件读写（封面/补全元数据用）；readBinary 失败要抛错，writeBinary 尽力而为 */
  readBinary(path: string): Promise<ArrayBuffer>
  writeBinary(path: string, data: Blob): Promise<void>
  /** 本地封面缓存（IndexedDB） */
  getLocalCover(key: string): Promise<Blob | null>
  putLocalCover(key: string, blob: Blob): Promise<void>
  /** 删除封面（本地 + 远端，尽力而为）：条目被 GC / 重建时清理孤儿封面 */
  deleteCovers(keys: string[]): Promise<void>
  now(): number
}

export const SUMMARY_SUFFIX = '-完整摘要.md'
/** 与 webdav/browse.ts 的受支持扩展名一致 */
export const BOOK_EXTENSIONS = ['.epub', '.pdf', '.txt', '.md', '.markdown']
export const LIBRARY_DIR = '.juhua'
export const coverRemotePath = (syncPath: string, key: string) => `${syncPath}/${LIBRARY_DIR}/covers/${key}.webp`
/** 索引以 gzip 存放（一次请求读完全部文字元数据）；旧版明文 library.json 仅作读取兜底 */
export const libraryIndexPath = (syncPath: string) => `${syncPath}/${LIBRARY_DIR}/library.json.gz`
export const legacyLibraryIndexPath = (syncPath: string) => `${syncPath}/${LIBRARY_DIR}/library.json`

export type RefreshPhase = 'mirror' | 'remote' | 'scan'
export interface RefreshOptions {
  /** 每个阶段拿到更新后的索引就回调一次，界面可以逐步刷新 */
  onUpdate?: (index: LibraryIndex, phase: RefreshPhase) => void
  /** 跳过扫描（只读缓存）：离线或用户只想看已有书库 */
  skipScan?: boolean
}
export interface RefreshResult {
  index: LibraryIndex
  /** 扫描是否成功；false 时索引来自缓存，界面应提示"可能不是最新" */
  scanned: boolean
  error?: string
  added: string[]
  removed: string[]
}

/** 受支持文件分流：真正的"书" vs 我们自己生成的摘要/内部文件 */
export function splitListing(files: ListedFile[], booksPath?: string): { sources: ScannedFile[]; summaryNames: Set<string> } {
  const summaryNames = new Set<string>()
  const sources: ScannedFile[] = []
  const root = booksPath ? booksPath.replace(/\/+$/, '') + '/' : null
  for (const f of files) {
    if (f.path.includes(`/${LIBRARY_DIR}/`)) continue
    if (f.basename.endsWith(SUMMARY_SUFFIX)) {
      summaryNames.add(f.basename)
      continue
    }
    if (!BOOK_EXTENSIONS.some((ext) => f.basename.toLowerCase().endsWith(ext))) continue
    if (root && !f.path.startsWith(root)) continue // 同步目录里的非摘要文件不是书
    if (GENERATED_ARTIFACT.test(f.basename)) continue
    sources.push({ path: f.path, size: f.size, mtime: f.mtime, etag: f.etag })
  }
  return { sources, summaryNames }
}

async function readRemoteIndex(io: LibraryIO): Promise<{ index: LibraryIndex | null; invalid: boolean }> {
  const text = await io.readRemote()
  if (text == null) return { index: null, invalid: false }
  try {
    const idx = migrateIndex(JSON.parse(text))
    return { index: idx, invalid: idx === null }
  } catch {
    return { index: null, invalid: true }
  }
}

/**
 * 写回：先重读远端合并（降低覆盖他人写入的概率），再按体积上限裁剪。
 * removed：本次 GC 删除的路径——必须在合并**之后**剔除，否则远端旧副本会把它们"复活"，GC 永不生效。
 */
export async function persistIndex(io: LibraryIO, index: LibraryIndex, removed: readonly string[] = []): Promise<LibraryIndex> {
  let merged = index
  try {
    const remote = await readRemoteIndex(io)
    if (remote.index) merged = mergeIndexes(remote.index, index)
  } catch {
    /* 远端读不到就用本地版本写；写失败由下面的 catch 吞掉，镜像仍然有效 */
  }
  if (removed.length) {
    const entries = { ...merged.entries }
    for (const path of removed) delete entries[path]
    merged = { ...merged, entries }
  }
  const { index: capped } = enforceSizeCap(merged)
  await io.writeMirror(capped)
  try {
    await io.writeRemote(JSON.stringify(capped))
  } catch {
    /* 远端写失败不影响本地使用，下次刷新会再试 */
  }
  return capped
}

export async function refreshLibrary(io: LibraryIO, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const now = io.now()
  let index = emptyIndex(now)

  // 1) 本地镜像：立刻可用
  const mirror = migrateIndex(await io.readMirror().catch(() => null))
  if (mirror) {
    index = mirror
    opts.onUpdate?.(index, 'mirror')
  }

  // 目录扫描不依赖镜像/远端索引：提前发起，与下面读远端索引并行（省一次 WebDAV 往返）
  const scanning = opts.skipScan ? null : io.listFiles().then((f) => ({ ok: true as const, files: f }), (e: unknown) => ({ ok: false as const, e }))

  // 2) 远端索引：与镜像合并；无效/高版本 → 丢弃（等扫描后重建）
  let error: string | undefined
  try {
    const remote = await readRemoteIndex(io)
    if (remote.index) {
      index = mergeIndexes(index, remote.index)
      opts.onUpdate?.(index, 'remote')
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  if (opts.skipScan) return { index, scanned: false, error, added: [], removed: [] }

  // 3) 扫描目录；失败就保留现有索引，不做 GC
  const listed = await scanning!
  if (!listed.ok) {
    const e = listed.e
    return { index, scanned: false, error: e instanceof Error ? e.message : String(e), added: [], removed: [] }
  }
  const files: ListedFile[] = listed.files
  const { sources, summaryNames } = splitListing(files, io.booksPath)
  const scan = applyScan(index, sources, { now, summaryNameOf: io.summaryNameOf, summaryNames })
  const before = index
  index = await persistIndex(io, scan.index, scan.removed)
  // 条目被 GC 后其封面成了孤儿：一并清理（失败无所谓，下次不会再被引用）
  const orphan = scan.removed.map((p) => before.entries[p]?.coverKey).filter((k): k is string => !!k)
  if (orphan.length) void io.deleteCovers(orphan).catch(() => {})
  opts.onUpdate?.(index, 'scan')
  return { index, scanned: true, error, added: scan.added, removed: scan.removed }
}

/** 重建：丢弃镜像与远端索引，从目录重新扫描。已读进度会丢失（设置页要明确提示） */
export async function rebuildLibrary(io: LibraryIO): Promise<RefreshResult> {
  const old = migrateIndex(await io.readMirror().catch(() => null))
  const oldCovers = Object.values(old?.entries ?? {}).map((e) => e.coverKey).filter((k): k is string => !!k)
  if (oldCovers.length) void io.deleteCovers(oldCovers).catch(() => {})
  await io.writeMirror(null)
  const files = await io.listFiles()
  const { sources, summaryNames } = splitListing(files, io.booksPath)
  const scan = applyScan(emptyIndex(io.now()), sources, { now: io.now(), summaryNameOf: io.summaryNameOf, summaryNames })
  await io.writeMirror(scan.index)
  await io.writeRemote(JSON.stringify(scan.index))
  return { index: scan.index, scanned: true, added: scan.added, removed: [] }
}

/** 只清本地镜像（不动远端索引，换设备也不受影响） */
export const clearLibraryMirror = (io: LibraryIO) => io.writeMirror(null)

/* ---- 条目级更新：读镜像 → 改一条 → 回写（镜像 + 远端） ---- */

async function mutate(io: LibraryIO, fn: (idx: LibraryIndex) => LibraryIndex): Promise<LibraryIndex | null> {
  const cur = migrateIndex(await io.readMirror().catch(() => null))
  if (!cur) return null
  const next = fn(cur)
  if (next === cur) return cur
  return persistIndex(io, next)
}

/** 打开一本书：记录时间；顺带写入补全的元数据（标题/作者/章数/字数），清除 stale */
export function recordOpened(
  io: LibraryIO,
  path: string,
  meta?: Partial<Pick<LibraryEntry, 'title' | 'author' | 'chapterCount' | 'wordCount'>>
) {
  return mutate(io, (idx) =>
    patchEntry(idx, path, { ...meta, ...(meta ? { stale: false } : {}), lastOpenedAt: io.now() }, io.now())
  )
}

/** 批量写入补全的元数据（不动 lastOpenedAt）；一次读-改-写，避免补全几十本书写几十次远端 */
export function recordMetadataBatch(
  io: LibraryIO,
  updates: { path: string; patch: Partial<Pick<LibraryEntry, 'title' | 'author' | 'pages' | 'chapterCount' | 'coverKey' | 'stale'>> }[]
) {
  return mutate(io, (idx) =>
    updates.reduce((acc, u) => patchEntry(acc, u.path, u.patch, io.now()), idx)
  )
}

/**
 * 采用云端封面 / 元数据：按书名主干匹配云端索引（精确 → 模糊），命中的 stale 条目直接得到
 * 书名 / 作者 / 页数 / 章数并清掉 stale（不用再下载整本书）；非 stale 条目只补封面键。一次读-改-写。
 */
export function adoptCloudCovers(io: LibraryIO, coverIndex: CoverIndex) {
  if (Object.keys(coverIndex).length === 0) return Promise.resolve(null)
  const norm = buildNormIndex(coverIndex)
  const good = (s?: string) => (s && !/^(未知|unknown)/i.test(s) ? s : undefined)
  return mutate(io, (idx) => {
    let next = idx
    for (const e of Object.values(idx.entries)) {
      if (isCloudCoverKey(e.coverKey) && !e.stale) continue
      const id = matchCoverId(e.path, coverIndex, norm)
      if (!id) continue
      const it = coverIndex[id]
      const patch: Parameters<typeof patchEntry>[2] = {}
      if (it.cover && e.coverKey !== id) patch.coverKey = id
      if (e.stale) {
        patch.stale = false
        patch.title = good(it.title) ?? e.title
        if (good(it.author)) patch.author = it.author
        if (it.pages) patch.pages = it.pages
        if (it.chapterCount) patch.chapterCount = it.chapterCount
      }
      if (Object.keys(patch).length) next = patchEntry(next, e.path, patch, io.now())
    }
    return next
  })
}

export function recordProgress(io: LibraryIO, path: string, chapterId: string, pct: number) {
  return mutate(io, (idx) =>
    patchEntry(idx, path, { readProgress: { chapterId, pct: Math.min(100, Math.max(0, pct)) } }, io.now())
  )
}

/**
 * 阅读进度（按源文件名定位条目）。进度没变就不写：每次写都是一次整份远端索引的读-改-写，
 * 读书时翻章很频繁，不能每翻一章都去打扰上游。条目不存在返回原索引。
 */
export function recordProgressByFileName(io: LibraryIO, fileName: string, chapterId: string, pct: number) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)))
  return mutate(io, (idx) => {
    const entry = Object.values(idx.entries).find((e) => baseName(e.path) === fileName)
    if (!entry || (entry.readProgress?.chapterId === chapterId && entry.readProgress.pct === clamped)) return idx
    return patchEntry(idx, entry.path, { readProgress: { chapterId, pct: clamped } }, io.now())
  })
}

/**
 * 记录该书当前「各章总结指纹」（清理「已过时」信封产物的唯一依据，见 docs/artifact-store.md §4）。
 * 条目不存在、指纹为空、指纹没变都不写：每次写都是一次整份远端索引的读-改-写，不能每打开一本书都打扰上游。
 */
export function recordStudyFp(io: LibraryIO, path: string, fp: string) {
  return mutate(io, (idx) => {
    const entry = idx.entries[path]
    if (!entry || !fp || entry.studyFp === fp) return idx
    return patchEntry(idx, path, { studyFp: fp }, io.now())
  })
}

/**
 * 同上，但按信封口径的书身份（`title|author`）匹配：调用方（打开书的那一侧）手里只有书名 / 作者，没有索引里的文件路径。
 * 同一本书可能有多份条目（同一本书传了两次），一并写上；匹配不到、值都没变就完全不动（不写回）。
 */
export function recordStudyFpByKey(io: LibraryIO, bookKey: string, fp: string) {
  return mutate(io, (idx) => {
    if (!bookKey || !fp) return idx
    let next = idx
    for (const e of Object.values(idx.entries)) {
      if (`${e.title}|${e.author ?? ''}` !== bookKey || e.studyFp === fp) continue
      next = patchEntry(next, e.path, { studyFp: fp }, io.now())
    }
    return next
  })
}

/** 处理完成 / 清缓存 / 删摘要：状态与摘要文件名一次改完（按源文件名定位条目） */
export function recordStatusByFileName(io: LibraryIO, fileName: string, status: BookStatus) {
  return mutate(io, (idx) => {
    const entry = Object.values(idx.entries).find((e) => baseName(e.path) === fileName)
    if (!entry) return idx
    return setStatus(idx, entry.path, status, io.summaryNameOf(fileName), io.now())
  })
}
