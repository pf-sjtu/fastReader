// WebDAV 文件列表的纯函数：路径、扩展名、过滤、排序
import type { WebDAVFileInfo } from '../../../services/webdavService'
import { normalizeDavPath } from '../../../services/webdavProxyUtils'

export type SortBy = 'name' | 'time' | 'random'
export type SortOrder = 'asc' | 'desc'

/** '.epub' 形式的小写扩展名；无扩展名时返回 '.'+整名（与旧逻辑一致，不会命中白名单） */
export function extOf(name: string): string {
  return '.' + name.toLowerCase().split('.').pop()
}

/** 目录条目 → 以 / 结尾的规范路径 */
export function directoryPath(dir: WebDAVFileInfo): string {
  const p = normalizeDavPath(dir.filename)
  return p.endsWith('/') ? p : p + '/'
}

/** 上级目录；根目录返回 null */
export function parentPath(path: string): string | null {
  if (path === '/' || path === '') return null
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : '/' + parts.join('/') + '/'
}

/** 按搜索词与扩展名白名单过滤（目录总是保留） */
export function filterEntries(files: WebDAVFileInfo[], query: string, allowed: string[]): WebDAVFileInfo[] {
  const q = query.toLowerCase()
  return files.filter((f) => {
    if (q && !f.basename.toLowerCase().includes(q)) return false
    if (f.type === 'file' && allowed.length > 0) return allowed.includes(extOf(f.basename))
    return true
  })
}

/** 可复现的伪随机数（mulberry32）：同一 seed 每次渲染得到同一乱序，点「重新打乱」换 seed */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** 目录在前、文件在后，各自按规则排序；random 时用 seed 做 Fisher-Yates 乱序 */
export function sortEntries(files: WebDAVFileInfo[], by: SortBy, order: SortOrder, seed = 0): WebDAVFileInfo[] {
  const dirs = files.filter((f) => f.type === 'directory')
  const rest = files.filter((f) => f.type === 'file')
  if (by === 'random') {
    const rand = seededRandom(seed)
    return [...shuffle(dirs, rand), ...shuffle(rest, rand)]
  }
  const sign = order === 'asc' ? 1 : -1
  const cmp = (a: WebDAVFileInfo, b: WebDAVFileInfo) =>
    by === 'name'
      ? sign * a.basename.localeCompare(b.basename)
      : sign * (new Date(a.lastmod).getTime() - new Date(b.lastmod).getTime())
  return [...dirs.sort(cmp), ...rest.sort(cmp)]
}
