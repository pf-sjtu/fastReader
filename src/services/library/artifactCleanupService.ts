/**
 * 过时产物清理的编排：扫描 → 分类（artifactCleanup）→ 用户勾选 → 逐个删除。
 * 只做 IO 与安全闸，分类规则在 artifactCleanup.ts。
 *
 * 两类扫描对象：
 *   1. 同步目录下与书同级的旧式产物（`io.listFiles()` 里同步目录之下的那部分）；
 *   2. `.juhua/books/<bookFolder>/` 下的信封包（docs/artifact-store.md §4）。
 *
 * 包扫描整体失败、单包读取失败都只是**少列几项**，绝不把不确定的东西列进清单
 * （清理是不可逆删除：宁可漏删，不可误删）；失败也不把整体判成 scan-failed——
 * 旧式产物那一半仍然可用。
 */
import { ARTIFACT_DIR, parseEnvelopeText, type ArtifactKind as EnvelopeKind } from '@/services/artifacts/envelope'
import { createArtifactIO, type ArtifactIO } from '@/services/artifacts/io'
import { webdavService } from '@/services/webdavService'
import { logger } from '@/lib/logger'
import {
  ENVELOPE_FILE,
  classifyStaleArtifacts,
  classifyStalePackages,
  compareStaleArtifacts,
  type LiveBook,
  type ScannedEnvelopeFile,
  type ScannedPackage,
  type StaleArtifact,
} from './artifactCleanup'
import { baseName } from './libraryIndex'
import type { CoverIndex } from './cloudCovers'
import type { LibraryIO } from './libraryService'
import type { LibraryIndex } from './types'

export type ScanOutcome =
  | { ok: true; items: StaleArtifact[] }
  /** no-books：同步目录里一本书都没扫到（多半目录配错）——此时「书不在」的判断不可信，拒绝给出清单 */
  | { ok: false; reason: 'no-books' | 'scan-failed'; error?: string }

/**
 * 信封包需要一个额外的「列子目录」：`ArtifactIO.list` 只返回文件，拿不到 bookFolder 目录名。
 * 单测注入假实现，生产走 WebDAV。
 */
export interface ArtifactPackageIO extends ArtifactIO {
  listDirNames(dir: string): Promise<string[]>
}

/** 生产实现：在 `createArtifactIO` 之上补一个列子目录（没有 WebDAV 时返回 null） */
export function createPackageIO(): ArtifactPackageIO | null {
  const base = createArtifactIO()
  if (!base) return null
  return {
    ...base,
    listDirNames: async (dir) => {
      try {
        const r = await webdavService.getDirectoryContents(dir)
        if (!r.success || !r.data) return []
        return r.data.filter((f) => f.type === 'directory').map((f) => f.basename)
      } catch {
        return []
      }
    },
  }
}

/** 小并发跑任务，结果保持输入顺序 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

const PACKAGE_CONCURRENCY = 3

/** 扫 `.juhua/books` 下的信封包；列目录失败 / 空目录都当「这个包不动」 */
async function scanPackages(pkg: ArtifactPackageIO, syncPath: string): Promise<ScannedPackage[]> {
  const root = `${syncPath.replace(/\/+$/, '')}/${ARTIFACT_DIR}`
  const folders = await pkg.listDirNames(root)
  const scanned = await mapLimit(folders, PACKAGE_CONCURRENCY, async (folder): Promise<ScannedPackage | null> => {
    const dir = `${root}/${folder}`
    const entries = await pkg.list(dir)
    if (!entries.length) return null
    const files: ScannedEnvelopeFile[] = []
    for (const e of entries) {
      const base = { path: e.path, basename: e.basename, size: e.size, mtime: e.mtime }
      if (e.isDir || !ENVELOPE_FILE.test(e.basename)) {
        // 包内多出来的东西：不认识的 kind（分类时整包跳过）
        files.push({ ...base, kind: null, parsed: null })
        continue
      }
      const kind = e.basename.split('.')[0] as EnvelopeKind
      try {
        const text = await pkg.read(e.path)
        files.push({ ...base, kind, parsed: text == null ? null : parseEnvelopeText(text, kind) })
      } catch (err) {
        // 读失败：这份当读不懂（分类时整包跳过），记一笔便于排查
        logger.warn('[library] 读取产物信封失败，该包跳过', e.path, err)
        files.push({ ...base, kind, parsed: null })
      }
    }
    return { path: dir, folder, files }
  })
  return scanned.filter((p): p is ScannedPackage => !!p)
}

/**
 * 扫描同步目录与 `.juhua/books`，找出过时产物。
 * 前提由调用方保证：index 来自本会话一次**成功且完整**的扫描（见 libraryStore.fresh / listTree 的整体失败语义）。
 *
 * `packages` 默认取生产实现；显式传 `null` 可只扫旧式产物（WebDAV 没连上时就是这种情况）。
 */
export async function scanStaleArtifacts(
  io: LibraryIO,
  index: LibraryIndex,
  catalog: CoverIndex,
  packages: ArtifactPackageIO | null = createPackageIO()
): Promise<ScanOutcome> {
  const realBooks = Object.values(index.entries).filter((e) => !e.virtual)
  if (!realBooks.length) return { ok: false, reason: 'no-books' }
  try {
    const files = await io.listFiles()
    // 「书还在」的摘要名：WebDAV 上的真书 + 云端书目里记录的书（云端有记录就不算「书已不在」）
    const live = new Set<string>()
    for (const e of realBooks) live.add(io.summaryNameOf(baseName(e.path)))
    for (const it of Object.values(catalog)) if (it.file) live.add(io.summaryNameOf(it.file))
    const syncFiles = files
      .filter((f) => f.path.startsWith(io.syncPath.replace(/\/+$/, '') + '/'))
      .map((f) => ({ path: f.path, basename: f.basename, size: f.size, mtime: f.mtime }))
    const items = classifyStaleArtifacts({ files: syncFiles, liveSummaryNames: live, syncPath: io.syncPath })

    // 信封包：同一套「书还在」判断，外加每本书当前的章节总结指纹（判「已过时」）
    if (packages) {
      try {
        const liveBooks: LiveBook[] = [
          ...realBooks.map((e) => ({ title: e.title, author: e.author, studyFp: e.studyFp })),
          ...Object.values(catalog).map((it) => ({ title: it.title, author: it.author })),
        ]
        const packagesScanned = await scanPackages(packages, io.syncPath)
        items.push(...classifyStalePackages({ packages: packagesScanned, liveBooks }))
        items.sort(compareStaleArtifacts)
      } catch (e) {
        logger.warn('[library] 扫描产物信封包失败，本次不列信封', e)
      }
    }
    return { ok: true, items }
  } catch (e) {
    return { ok: false, reason: 'scan-failed', error: e instanceof Error ? e.message : String(e) }
  }
}

export interface DeleteResult {
  deleted: string[]
  failed: { path: string; error: string }[]
}

/**
 * 整包删除的安全闸：只允许删 `<同步目录>/.juhua/books/<单层目录>` 这一层。
 * 目录删除是递归且不可逆的，所以逐层挡住：相对路径穿越（`.` / `..`）、被百分号编码过的 `%2e` / `%2f` / `%5c`、
 * 名字里还带分隔符或 `%`、以及不在本次同步目录前缀之下的路径。宁可不删，也不能删到别处。
 *
 * 不传 `syncPath` 时退化为「路径里含有 `.juhua/books/`」（兼容旧调用）；传了就要求严格前缀。
 */
export function isArtifactPackageDir(path: string, syncPath = ''): boolean {
  const marker = `/${ARTIFACT_DIR}/`
  const trimmed = path.replace(/\/+$/, '')
  let folder: string
  if (syncPath) {
    // 必须严格落在本次同步目录的产物目录下：换过同步目录后，旧路径一律不算
    const root = `${syncPath.replace(/\/+$/, '')}${marker}`
    if (!trimmed.startsWith(root)) return false
    folder = trimmed.slice(root.length)
  } else {
    const at = trimmed.lastIndexOf(marker)
    if (at < 0) return false
    folder = trimmed.slice(at + marker.length)
  }
  // 编码坏了当非法；原始名字与解码后的名字都要是一层普通名字（防 `%2e%2e` 之类被上游解码成 `..`）
  let decoded: string
  try {
    decoded = decodeURIComponent(folder)
  } catch {
    return false
  }
  return [folder, decoded].every((name) => !!name && name !== '.' && name !== '..' && !/[/\\%]/.test(name))
}

/** 文件项也必须落在本次同步目录之下（`syncPath` 为空时不校验，兼容旧调用） */
const inSyncDir = (path: string, syncPath: string): boolean => {
  if (!syncPath) return true
  if (!path.startsWith(`${syncPath.replace(/\/+$/, '')}/`)) return false
  // 前缀对不代表没跳出去：`<同步目录>/../别处/x` 也以同步目录开头。原始与解码后的路径都不能含 `.` / `..` 段
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  return [path, decoded].every((p) => !p.split(/[/\\]/).some((seg) => seg === '..' || seg === '.'))
}

/**
 * 删除勾选的产物：并发 3，单个失败不影响其余；只接受 scanStaleArtifacts 给出的条目（调用方传入的就是它的子集）。
 * 整包（`dir: true`）走 `removeDir` 递归删目录（且必须通过 `isArtifactPackageDir` 安全校验），其余删单个文件；
 * 两类都先按 `syncPath` 校验包含性，不在同步目录里的条目一律拒绝删除并记进 `failed`。
 */
export async function deleteStaleArtifacts(
  items: readonly StaleArtifact[],
  deleteFile: (path: string) => Promise<{ success: boolean; error?: string }> = (p) => webdavService.deleteFile(p),
  concurrency = 3,
  removeDir: (path: string) => Promise<{ success: boolean; error?: string }> = (p) => webdavService.deleteDirectory(p),
  syncPath = ''
): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], failed: [] }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const it = items[next++]
        const safe = it.dir ? isArtifactPackageDir(it.path, syncPath) : inSyncDir(it.path, syncPath)
        if (!safe) {
          result.failed.push({ path: it.path, error: '路径不在产物目录内，已拒绝删除' })
          continue
        }
        try {
          const r = await (it.dir ? removeDir(it.path) : deleteFile(it.path))
          if (r.success) result.deleted.push(it.path)
          else result.failed.push({ path: it.path, error: r.error ?? '删除失败' })
        } catch (e) {
          result.failed.push({ path: it.path, error: e instanceof Error ? e.message : String(e) })
        }
      }
    })
  )
  return result
}
