import type { WebDAVFileInfo, WebDAVOperationResult } from '@/services/webdav/types'

/** 单层/深度列目录（webdavService.getDirectoryContents 的形状） */
export type ListDir = (dir: string, deep: boolean) => Promise<WebDAVOperationResult<WebDAVFileInfo[]>>

/** 兜底遍历的上限：防止异常目录结构把请求数拖到失控 */
export const MAX_DIRS = 200
export const MAX_DEPTH = 8

/**
 * 列出同步目录下的全部文件。
 * 优先一次深度列表（`Depth: infinity`，1 次请求）；很多 WebDAV 服务（如 InfiniCLOUD）会对它返回 403，
 * 此时退回逐层 `Depth: 1` 的广度优先遍历。根目录读不出来 = 真失败；子目录读不出来只跳过该目录。
 * 以点开头的目录（`.juhua` 索引与封面）不进兜底遍历：里面没有书。
 */
export async function listTree(list: ListDir, root: string): Promise<WebDAVFileInfo[]> {
  const deep = await list(root, true)
  if (deep.success && deep.data) return deep.data

  const files: WebDAVFileInfo[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited < MAX_DIRS) {
    const { dir, depth } = queue.shift()!
    visited++
    const r = await list(dir, false)
    if (!r.success || !r.data) {
      if (dir === root) throw new Error(r.error ?? deep.error ?? '读取目录失败')
      continue
    }
    for (const f of r.data) {
      if (f.type === 'file') files.push(f)
      else if (f.type === 'directory' && depth < MAX_DEPTH && !f.basename.startsWith('.') && f.filename !== dir) {
        queue.push({ dir: f.filename, depth: depth + 1 })
      }
    }
  }
  return files
}
