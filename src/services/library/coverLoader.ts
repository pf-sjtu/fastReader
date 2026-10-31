/**
 * 封面懒加载：只有书卡进入视口才会请求；WebDAV 对并发很敏感，所以远端读取走全局队列（默认并发 2）。
 * 顺序：本地 IndexedDB（不占队列）→ 远端 covers/{key}.webp（排队，取到即缓存到本地）。
 * 同一封面的并发请求合并；失败在本次会话内记住，不会因为滚动反复重试同一个 404。
 */
import { coverRemotePath, type LibraryIO } from './libraryService'

export const COVER_FETCH_CONCURRENCY = 2

interface Options {
  getIO: () => LibraryIO | null
  concurrency?: number
}

export function createCoverLoader({ getIO, concurrency = COVER_FETCH_CONCURRENCY }: Options) {
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
      if (!io) return Promise.resolve(null)
      const cached = inflight.get(coverKey)
      if (cached) return cached
      const p = (async () => {
        const local = await io.getLocalCover(coverKey).catch(() => null)
        if (local) return local
        const remote = await fetchRemote(io, coverKey)
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
    stats: () => ({ active, waiting: waiting.length, failed: failed.size }),
  }
}
