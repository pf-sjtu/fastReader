/** 书库的界面状态：只放"当前看到的索引"和刷新状态，生命周期规则全部在 libraryService */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { createLibraryIO } from './libraryIO'
import { rebuildLibrary, recordOpened, recordStatusByFileName, refreshLibrary } from './libraryService'
import { emptyIndex } from './libraryIndex'
import { fillLibraryMetadata, type FillResult } from './libraryFill'
import type { BookStatus, LibraryEntry, LibraryIndex } from './types'

interface LibraryState {
  index: LibraryIndex
  /** 正在刷新（镜像已显示时，界面只在角落转圈，不遮住内容） */
  refreshing: boolean
  /** 上次扫描是否成功；false = 展示的是缓存，可能不是最新 */
  fresh: boolean
  error: string | null
  /** WebDAV 未启用/未初始化 */
  unavailable: boolean
  refresh: () => Promise<void>
  rebuild: () => Promise<void>
  markOpened: (entry: LibraryEntry, meta?: Parameters<typeof recordOpened>[2]) => Promise<void>
  /** 补全元数据（书名/作者/封面）的进度；null = 没在补全 */
  fillProgress: { done: number; total: number } | null
  fillMetadata: () => Promise<FillResult | null>
  cancelFill: () => void
}

let fillAbort: AbortController | null = null

let inflight: Promise<void> | null = null

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  index: emptyIndex(0),
  refreshing: false,
  fresh: false,
  error: null,
  unavailable: false,
  fillProgress: null,

  // 并发调用合并成一次（切回页面、手动点刷新可能同时触发）
  refresh: () => {
    if (inflight) return inflight
    const io = createLibraryIO()
    if (!io) {
      set({ unavailable: true })
      return Promise.resolve()
    }
    set({ refreshing: true, unavailable: false })
    inflight = refreshLibrary(io, { onUpdate: (index) => set({ index }) })
      .then((r) => set({ index: r.index, fresh: r.scanned, error: r.error ?? null }))
      .catch((e) => {
        logger.error('[library] 刷新失败', e)
        set({ error: e instanceof Error ? e.message : String(e), fresh: false })
      })
      .finally(() => {
        inflight = null
        set({ refreshing: false })
      })
    return inflight
  },

  rebuild: async () => {
    const io = createLibraryIO()
    if (!io) return
    set({ refreshing: true })
    try {
      const r = await rebuildLibrary(io)
      set({ index: r.index, fresh: true, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ refreshing: false })
    }
  },

  // 要下载整本书（流量不小），只在用户点击时运行；并发 2、可取消
  fillMetadata: async () => {
    const io = createLibraryIO()
    if (!io || get().fillProgress) return null
    const stale = Object.values(get().index.entries).filter((e) => e.stale)
    if (!stale.length) return null
    fillAbort = new AbortController()
    set({ fillProgress: { done: 0, total: stale.length } })
    try {
      const r = await fillLibraryMetadata(io, stale, {
        signal: fillAbort.signal,
        onProgress: (done, total) => set({ fillProgress: { done, total } }),
      })
      if (r.index) set({ index: r.index })
      return r
    } catch (e) {
      logger.error('[library] 补全元数据失败', e)
      return null
    } finally {
      fillAbort = null
      set({ fillProgress: null })
    }
  },
  cancelFill: () => fillAbort?.abort(),

  markOpened: async (entry, meta) => {
    const io = createLibraryIO()
    if (!io) return
    const next = await recordOpened(io, entry.path, meta).catch(() => null)
    if (next) set({ index: next })
    else void get().refresh()
  },
}))

/**
 * 处理完成/清缓存时同步书库状态。尽力而为：书库没启用、条目不存在、网络失败都静默跳过
 * （下一次扫描会按摘要文件是否存在自动校正，所以丢一次同步不会留下错误状态）。
 */
export function syncLibraryStatus(fileName: string, status: BookStatus): void {
  const io = createLibraryIO()
  if (!io) return
  void recordStatusByFileName(io, fileName, status)
    .then((idx) => {
      if (idx) useLibraryStore.setState({ index: idx })
    })
    .catch((e) => logger.warn('[library] 状态同步失败', e))
}
