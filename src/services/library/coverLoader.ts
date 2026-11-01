/**
 * 封面懒加载：只有书卡进入视口才会请求；WebDAV 对并发很敏感，所以远端读取走全局队列（默认并发 2）。
 * 顺序：本地 IndexedDB（不占队列）→ 远端 covers/{key}.webp（排队，取到即缓存到本地）。
 * 同一封面的并发请求合并；失败在本次会话内记住，不会因为滚动反复重试同一个 404。
 */
import { coverRemotePath, type LibraryIO } from './libraryService'
import { fetchCoverBlob, isCloudCoverKey, parseCloudCoverKey } from './cloudCovers'

/** WebDAV 旧封面（路径哈希键）对并发敏感：2 */
export const COVER_FETCH_CONCURRENCY = 4
/** 云端封面（KV，几 KB，边缘缓存）：可以放心多取几张 */
export const CLOUD_COVER_CONCURRENCY = 16

interface Options {
  getIO: () => LibraryIO | null
  concurrency?: number
  cloudConcurrency?: number
  fetchCloud?: (id: string, version?: string) => Promise<Blob | null>
}

export function createCoverLoader({ getIO, concurrency = COVER_FETCH_CONCURRENCY, cloudConcurrency = CLOUD_COVER_CONCURRENCY, fetchCloud = (id, v) => fetchCoverBlob(id, fetch, v) }: Options) {
  const inflight = new Map<string, Promise<Blob | null>>()
  const failed = new Set<string>()
  let active = 0
  const waiting: (() => void)[] = []

  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < concurrency) {
        active++
        resolve()
      } else waiting.push(() => (active++, resolve()))
    })
  const release = () => {
    active--
    waiting.shift()?.()
  }
  // 云端封面独立限流：不和 WebDAV 抢并发额度
  let cloudActive = 0
  const cloudWaiting: (() => void)[] = []
  const cloudAcquire = () =>
    new Promise<void>((resolve) => {
      if (cloudActive < cloudConcurrency) {
        cloudActive++
        resolve()
      } else cloudWaiting.push(() => (cloudActive++, resolve()))
    })
  const cloudRelease = () => {
    cloudActive--
    cloudWaiting.shift()?.()
  }

  /** io 可为空：云端封面不依赖 WebDAV（书架在 WebDAV 连上之前就要显示）；此时不写本地缓存，交给浏览器的 HTTP 缓存（不可变资源） */
  async function fetchCloudCover(io: LibraryIO | null, key: string): Promise<Blob | null> {
    await cloudAcquire()
    try {
      const { id, v } = parseCloudCoverKey(key)
      const blob = await fetchCloud(id, v)
      // 本地缓存按「带版本的键」存：封面被替换后（版本变了）旧缓存不会再命中
      if (blob && io) await io.putLocalCover(key, blob).catch(() => {})
      return blob
    } finally {
      cloudRelease()
    }
  }

  async function fetchRemote(io: LibraryIO, key: string): Promise<Blob | null> {
    await acquire()
    try {
      const buf = await io.readBinary(coverRemotePath(io.syncPath, key))
      const blob = new Blob([buf], { type: 'image/webp' })
      await io.putLocalCover(key, blob)
      return blob
    } catch {
      return null
    } finally {
      release()
    }
  }

  return {
    load(coverKey: string | undefined): Promise<Blob | null> {
      if (!coverKey || failed.has(coverKey)) return Promise.resolve(null)
      const io = getIO()
      const cloud = isCloudCoverKey(coverKey)
      // WebDAV 封面必须有 IO；云端封面没有也能取
      if (!io && !cloud) return Promise.resolve(null)
      const cached = inflight.get(coverKey)
      if (cached) return cached
      const p = (async () => {
        const local = io ? await io.getLocalCover(coverKey).catch(() => null) : null
        if (local) return local
        const remote = cloud ? await fetchCloudCover(io, coverKey) : await fetchRemote(io!, coverKey)
        if (!remote) failed.add(coverKey)
        return remote
      })().finally(() => inflight.delete(coverKey))
      inflight.set(coverKey, p)
      return p
    },
    /** 补全元数据后封面键变化/新生成：清掉失败记录，允许重新加载 */
    forget(coverKey: string) {
      failed.delete(coverKey)
    },
    stats: () => ({ active: active + cloudActive, waiting: waiting.length + cloudWaiting.length, failed: failed.size }),
  }
}
