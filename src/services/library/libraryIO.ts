/** 书库 IO 的生产实现：WebDAV（经 /api/dav 代理）+ IndexedDB 镜像 */
import { createStore, del, get, set } from 'idb-keyval'
import { webdavService } from '@/services/webdavService'
import { cloudCacheService } from '@/services/cloudCacheService'
import { useConfigStore } from '@/stores/configStore'
import { libraryIndexPath, type LibraryIO } from './libraryService'

let kv: ReturnType<typeof createStore> | null = null
const store = () => (kv ??= createStore('juhua-library', 'index'))

/** 无可用 WebDAV 时返回 null：书库本身依赖云端目录 */
export function createLibraryIO(): LibraryIO | null {
  const cfg = useConfigStore.getState().webdavConfig
  if (!cfg.enabled || !webdavService.isInitialized()) return null
  const syncPath = cfg.syncPath || '/fastReader'
  const scopeKey = `${cfg.serverUrl}|${cfg.username ?? ''}|${syncPath}`
  const path = libraryIndexPath(syncPath)

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
      const status = await webdavService.existsStatus(path)
      if (status === 'missing') return null
      const r = await webdavService.getFileContents(path, 'text')
      if (!r.success) throw new Error(r.error ?? '读取书库索引失败')
      return typeof r.data === 'string' ? r.data : new TextDecoder().decode(r.data as ArrayBuffer)
    },
    writeRemote: async (text) => {
      const r = await webdavService.putFileContents(path, text, true)
      if (!r.success) throw new Error(r.error ?? '写入书库索引失败')
    },
    listFiles: async () => {
      const r = await webdavService.getDirectoryContents(syncPath, true)
      if (!r.success || !r.data) throw new Error(r.error ?? '读取目录失败')
      return r.data
        .filter((f) => f.type === 'file')
        .map((f) => ({ path: f.filename, basename: f.basename, size: f.size, mtime: f.lastmod, etag: f.etag }))
    },
    summaryNameOf: (n) => cloudCacheService.getCacheFileName(n),
    now: () => Date.now(),
  }
}
