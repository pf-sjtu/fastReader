/** 书库 IO 的生产实现：WebDAV（经 /api/dav 代理）+ IndexedDB 镜像 */
import { listTree } from './listTree'
import { createStore, del, get, set } from 'idb-keyval'
import { webdavService } from '@/services/webdavService'
import { cloudCacheService } from '@/services/cloudCacheService'
import { useConfigStore } from '@/stores/configStore'
import { coverRemotePath, legacyLibraryIndexPath, libraryIndexPath, type LibraryIO } from './libraryService'
import { gunzipToText, gzipText, isGzip } from './gzip'

let kv: ReturnType<typeof createStore> | null = null
const store = () => (kv ??= createStore('juhua-library', 'index'))

type DavCfg = ReturnType<typeof useConfigStore.getState>['webdavConfig']

/** 同步目录 / 书目录 / 镜像分区键：镜像按它分开，换账号或换目录不串书 */
function scopeOf(cfg: DavCfg) {
  const syncPath = cfg.syncPath || '/fastReader'
  // 书放在浏览根（如 /EBook），摘要写在同步目录；没配或是根目录就退回同步目录
  const browse = (cfg.browsePath || '').replace(/\/+$/, '')
  const booksPath = browse && browse !== syncPath ? browse : undefined
  const scopeKey = `${cfg.serverUrl}|${cfg.username ?? ''}|${syncPath}|${booksPath ?? ''}`
  return { syncPath, booksPath, scopeKey }
}

/**
 * 读本地镜像：只要启用了 WebDAV 就能读，不必等连接建好。
 * 首屏连接要几十秒（先登录、加载共享状态、再连云），这段时间先把上次的书架摆出来。
 */
export async function readLibraryMirror(): Promise<unknown | null> {
  const cfg = useConfigStore.getState().webdavConfig
  if (!cfg.enabled) return null
  return (await get(scopeOf(cfg).scopeKey, store())) ?? null
}

/** 无可用 WebDAV 时返回 null：书库本身依赖云端目录 */
export function createLibraryIO(): LibraryIO | null {
  const cfg = useConfigStore.getState().webdavConfig
  if (!cfg.enabled || !webdavService.isInitialized()) return null
  const { syncPath, booksPath, scopeKey } = scopeOf(cfg)
  const path = libraryIndexPath(syncPath)
  const legacyPath = legacyLibraryIndexPath(syncPath)

  return {
    booksPath,
    scopeKey,
    syncPath,
    readMirror: async () => (await get(scopeKey, store())) ?? null,
    writeMirror: async (index) => {
      if (index) await set(scopeKey, index, store())
      else await del(scopeKey, store())
    },
    readRemote: async () => {
      // 不存在 ≠ 读取失败：前者是首次使用，后者要把错误交给界面
      for (const p of [path, legacyPath]) {
        const status = await webdavService.existsStatus(p)
        if (status === 'missing') continue
        const r = await webdavService.getFileContents(p, 'binary')
        if (!r.success || !(r.data instanceof ArrayBuffer)) throw new Error(r.error ?? '读取书库索引失败')
        return isGzip(r.data) ? gunzipToText(r.data) : new TextDecoder().decode(r.data)
      }
      return null
    },
    writeRemote: async (text) => {
      const r = await webdavService.putFileContents(path, await gzipText(text), true)
      if (!r.success) throw new Error(r.error ?? '写入书库索引失败')
    },
    listFiles: async () => {
      const list = (dir: string, deep: boolean) => webdavService.getDirectoryContents(dir, deep)
      // 书目录 + 同步目录（摘要）；两者重叠（同步目录在书目录里）时按路径去重
      const roots = booksPath && !syncPath.startsWith(booksPath + '/') ? [booksPath, syncPath] : [booksPath ?? syncPath]
      // 两个根互不依赖：并行扫（每次往返 0.5–2s，串行会白白叠加）
      const lists = await Promise.all(roots.map((root) => listTree(list, root)))
      const byPath = new Map(lists.flat().map((f) => [f.filename, f]))
      return [...byPath.values()]
        .filter((f) => f.type === 'file')
        .map((f) => ({ path: f.filename, basename: f.basename, size: f.size, mtime: f.lastmod, etag: f.etag }))
    },
    summaryNameOf: (n) => cloudCacheService.getCacheFileName(n),
    readBinary: async (p) => {
      const r = await webdavService.getFileContents(p, 'binary')
      if (!r.success || !(r.data instanceof ArrayBuffer)) throw new Error(r.error ?? '下载失败')
      return r.data
    },
    writeBinary: async (p, data) => {
      const r = await webdavService.putFileContents(p, await data.arrayBuffer(), true)
      if (!r.success) throw new Error(r.error ?? '上传失败')
    },
    getLocalCover: async (key) => (await get(`cover|${scopeKey}|${key}`, store())) ?? null,
    putLocalCover: async (key, blob) => {
      await set(`cover|${scopeKey}|${key}`, blob, store())
    },
    deleteCovers: async (keys) => {
      for (const k of keys) {
        await del(`cover|${scopeKey}|${k}`, store())
        await webdavService.deleteFile(coverRemotePath(syncPath, k)).catch(() => {})
      }
    },
    now: () => Date.now(),
  }
}
