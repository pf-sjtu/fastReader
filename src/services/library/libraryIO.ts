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

/** 无可用 WebDAV 时返回 null：书库本身依赖云端目录 */
export function createLibraryIO(): LibraryIO | null {
  const cfg = useConfigStore.getState().webdavConfig
  if (!cfg.enabled || !webdavService.isInitialized()) return null
  const syncPath = cfg.syncPath || '/fastReader'
  const scopeKey = `${cfg.serverUrl}|${cfg.username ?? ''}|${syncPath}`
  const path = libraryIndexPath(syncPath)
  const legacyPath = legacyLibraryIndexPath(syncPath)

  return {
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
      const all = await listTree((dir, deep) => webdavService.getDirectoryContents(dir, deep), syncPath)
      return all
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
