/**
 * 过时产物清理的编排：扫描 → 分类（artifactCleanup）→ 用户勾选 → 逐个删除。
 * 只做 IO 与安全闸，分类规则在 artifactCleanup.ts。
 */
import { webdavService } from '@/services/webdavService'
import { classifyStaleArtifacts, type StaleArtifact } from './artifactCleanup'
import { baseName } from './libraryIndex'
import type { CoverIndex } from './cloudCovers'
import type { LibraryIO } from './libraryService'
import type { LibraryIndex } from './types'

export type ScanOutcome =
  | { ok: true; items: StaleArtifact[] }
  /** no-books：同步目录里一本书都没扫到（多半目录配错）——此时「书不在」的判断不可信，拒绝给出清单 */
  | { ok: false; reason: 'no-books' | 'scan-failed'; error?: string }

/**
 * 扫描同步目录并找出过时产物。
 * 前提由调用方保证：index 来自本会话一次**成功且完整**的扫描（见 libraryStore.fresh / listTree 的整体失败语义）。
 */
export async function scanStaleArtifacts(io: LibraryIO, index: LibraryIndex, catalog: CoverIndex): Promise<ScanOutcome> {
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
    return { ok: true, items: classifyStaleArtifacts({ files: syncFiles, liveSummaryNames: live, syncPath: io.syncPath }) }
  } catch (e) {
    return { ok: false, reason: 'scan-failed', error: e instanceof Error ? e.message : String(e) }
  }
}

export interface DeleteResult {
  deleted: string[]
  failed: { path: string; error: string }[]
}

/** 删除勾选的产物：并发 3，单个失败不影响其余；只接受 scanStaleArtifacts 给出的条目（调用方传入的就是它的子集） */
export async function deleteStaleArtifacts(
  items: readonly StaleArtifact[],
  deleteFile: (path: string) => Promise<{ success: boolean; error?: string }> = (p) => webdavService.deleteFile(p),
  concurrency = 3
): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], failed: [] }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const it = items[next++]
        try {
          const r = await deleteFile(it.path)
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
