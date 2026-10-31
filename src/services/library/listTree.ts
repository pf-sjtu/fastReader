import type { WebDAVFileInfo, WebDAVOperationResult } from '@/services/webdav/types'

/** 单层/深度列目录（webdavService.getDirectoryContents 的形状） */
export type ListDir = (dir: string, deep: boolean) => Promise<WebDAVOperationResult<WebDAVFileInfo[]>>

/** 兜底遍历的上限：防止异常目录结构把请求数拖到失控 */
export const MAX_DIRS = 400
export const MAX_DEPTH = 8
/** 兜底遍历的并发数：够快，又不至于把服务端的限流打出来 */
export const CONCURRENCY = 6

/**
 * 列出同步目录下的全部文件。
 * 优先一次深度列表（`Depth: infinity`，1 次请求）；很多 WebDAV 服务（如 InfiniCLOUD）会对它返回 403，
 * 此时退回逐层 `Depth: 1` 的广度优先遍历。根目录读不出来 = 真失败；子目录读不出来只跳过该目录。
 * 以点开头的目录（`.juhua` 索引与封面）不进兜底遍历：里面没有书。
 * 兜底遍历超过上限会抛错（不返回残缺列表，避免 GC 误删）。
 */
export async function listTree(list: ListDir, root: string): Promise<WebDAVFileInfo[]> {
  const deep = await list(root, true)
  if (deep.success && deep.data) return deep.data

  const files: WebDAVFileInfo[] = []
  let level: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0
  // 逐层并行：同一层的目录互不依赖，6 路并发（原先串行，646 本书的库要 16 秒）；
  // 结果按队列顺序合并，所以输出顺序与串行遍历一致
  while (level.length && visited < MAX_DIRS) {
    const batch = level.slice(0, MAX_DIRS - visited)
    const rest = level.slice(batch.length)
    visited += batch.length
    const results: Awaited<ReturnType<ListDir>>[] = new Array(batch.length)
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (next < batch.length) {
          const i = next++
          results[i] = await list(batch[i].dir, false)
        }
      })
    )
    const nextLevel: { dir: string; depth: number }[] = []
    batch.forEach(({ dir, depth }, i) => {
      const r = results[i]
      if (!r.success || !r.data) {
        if (dir === root) throw new Error(r.error ?? deep.error ?? '读取目录失败')
        return
      }
      for (const f of r.data) {
        if (f.type === 'file') files.push(f)
        else if (f.type === 'directory' && depth < MAX_DEPTH && !f.basename.startsWith('.') && f.filename !== dir) {
          nextLevel.push({ dir: f.filename, depth: depth + 1 })
        }
      }
    })
    level = [...rest, ...nextLevel]
  }
  // 没遍历完就返回一半会让「没扫到的书」被 GC 当成已删除：宁可明确失败
  if (level.length) throw new Error(`目录太多（超过 ${MAX_DIRS} 个），书库没有扫描完整；请缩小书籍目录范围`)
  return files
}
