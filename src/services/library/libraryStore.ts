/**
 * 书库的界面状态。数据来源分两层：
 *   catalog  云端书目（Cloudflare KV）——书架的主数据，不需要 WebDAV 就能显示
 *   index    WebDAV 书库索引（本地镜像 + 扫描结果）——只提供状态 / 进度 / 真实路径
 * 书架 = buildShelf(index, catalog)（见 cloudCatalog）。WebDAV 只在真正用到内容（打开书、处理、手动刷新）时才访问。
 * 生命周期规则全部在 libraryService / cloudCatalog，这里只做编排。
 */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { webdavService } from '@/services/webdavService'
import { createLibraryIO, readLibraryMirror } from './libraryIO'
import { useConfigStore } from '@/stores/configStore'
import { adoptCloudCovers, persistIndex, rebuildLibrary, recordMetadataBatch, recordOpened, recordProgressByFileName, recordStatusByFileName, refreshLibrary } from './libraryService'
import { emptyIndex, migrateIndex } from './libraryIndex'
import { fillLibraryMetadata, inspectBook, type FillResult } from './libraryFill'
import { bookIdOf } from './bookId'
import { buildCatalogMeta, findRealEntry } from './cloudCatalog'
import { deleteCovers, fetchCoverIndex, isCloudCoverKey, uploadCover, type CoverIndex, type CoverItem } from './cloudCovers'
import type { BookStatus, LibraryEntry, LibraryIndex } from './types'

/** 点开一本书前先解析它在 WebDAV 上的真实条目 */
export type Resolved =
  | { kind: 'ok'; entry: LibraryEntry }
  /** WebDAV 连接正常、扫描成功，但就是没有这本书：交给用户决定要不要删云端 metadata */
  | { kind: 'missing'; entry: LibraryEntry }
  /** 连不上 / 扫描失败：什么都不能断定，更不能删任何东西 */
  | { kind: 'unreachable'; reason: 'off' | 'timeout' | 'scan-failed' }

interface LibraryState {
  index: LibraryIndex
  /** 云端书目（KV）；catalogLoaded 之前书架可能是空的，界面应显示「加载中」而不是「没有书」 */
  catalog: CoverIndex
  catalogLoaded: boolean
  /** 正在刷新（镜像已显示时，界面只在角落转圈，不遮住内容） */
  refreshing: boolean
  /** 本次会话内是否成功扫描过 WebDAV；false = 状态/进度来自镜像，可能不是最新 */
  fresh: boolean
  error: string | null
  /** WebDAV 未启用 */
  unavailable: boolean
  /** WebDAV 已启用但还在连接 */
  connecting: boolean
  /** 等待用户确认「WebDAV 上已找不到」的书；null = 没有 */
  missing: LibraryEntry | null
  /** 读云端书目（失败时保留已有的，不把书架清空） */
  loadCatalog: () => Promise<void>
  /** 只读本地镜像（不联网）：状态 / 进度 / 上次扫到的真实路径 */
  loadMirror: () => Promise<void>
  /** 扫描 WebDAV（手动刷新、或打开书时需要确认某本书存在） */
  refresh: () => Promise<void>
  rebuild: () => Promise<void>
  resolveEntry: (entry: LibraryEntry) => Promise<Resolved>
  markOpened: (entry: LibraryEntry, meta?: Parameters<typeof recordOpened>[2]) => Promise<void>
  /** 用户点开（已下载）一本书：云端缺信息 / 书变了就解析并补传，写回书库 */
  contributeOpened: (entry: LibraryEntry, file: File) => Promise<void>
  /** 登记 / 取消「WebDAV 上已找不到」的待确认项 */
  askRemove: (entry: LibraryEntry | null) => void
  /** 删除这些书的云端 metadata（并从书库索引里去掉真实条目）；返回删掉几本 */
  removeBooks: (entries: readonly LibraryEntry[]) => Promise<number>
  /** 补全元数据（书名/作者/封面）的进度；null = 没在补全 */
  fillProgress: { done: number; total: number } | null
  fillMetadata: () => Promise<FillResult | null>
  cancelFill: () => void
}

let fillAbort: AbortController | null = null
let inflight: Promise<void> | null = null
let catalogInflight: Promise<void> | null = null

/** 等 WebDAV 连上（首屏连接可能要几十秒）。没启用 / 超时返回 false */
function waitForWebdav(timeoutMs = 15000): Promise<boolean> {
  if (createLibraryIO()) return Promise.resolve(true)
  if (!useConfigStore.getState().webdavConfig.enabled) return Promise.resolve(false)
  return new Promise((resolve) => {
    let off = () => {}
    const timer = setTimeout(() => {
      off()
      resolve(false)
    }, timeoutMs)
    off = webdavService.onInitialized(() => {
      clearTimeout(timer)
      off()
      resolve(true)
    })
  })
}

const isIncomplete = (it: CoverItem | undefined) => !it || !it.cover || !it.subjects?.length || !it.file

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  index: emptyIndex(0),
  catalog: {},
  catalogLoaded: false,
  refreshing: false,
  fresh: false,
  error: null,
  unavailable: false,
  connecting: false,
  missing: null,
  fillProgress: null,

  loadCatalog: () => {
    if (catalogInflight) return catalogInflight
    catalogInflight = fetchCoverIndex()
      .then((c) => {
        // 失败时 fetchCoverIndex 返回空：已有目录就别覆盖成空
        if (Object.keys(c).length > 0 || Object.keys(get().catalog).length === 0) set({ catalog: c })
      })
      .finally(() => {
        catalogInflight = null
        set({ catalogLoaded: true })
      })
    return catalogInflight
  },

  loadMirror: async () => {
    const cfg = useConfigStore.getState().webdavConfig
    if (!cfg.enabled) {
      set({ unavailable: true, connecting: false })
      return
    }
    set({ unavailable: false })
    try {
      const cached = migrateIndex(await readLibraryMirror())
      if (cached && Object.keys(get().index.entries).length === 0) set({ index: cached })
    } catch {
      /* 镜像读不到不要紧：书架照样由云端书目撑起来 */
    }
  },

  // 并发调用合并成一次（切回页面、手动点刷新可能同时触发）
  refresh: () => {
    if (inflight) return inflight
    const io = createLibraryIO()
    if (!io) {
      if (!useConfigStore.getState().webdavConfig.enabled) {
        set({ unavailable: true, connecting: false })
        return Promise.resolve()
      }
      set({ unavailable: false, connecting: true })
      return get().loadMirror()
    }
    set({ refreshing: true, unavailable: false, connecting: false })
    inflight = Promise.all([refreshLibrary(io, { onUpdate: (index) => set({ index }) }), get().loadCatalog()])
      .then(async ([r]) => {
        set({ index: r.index, fresh: r.scanned, error: r.error ?? null })
        // 扫描成功后把云端 metadata 固化进真实条目（stale 的书直接补齐，镜像离线也有）；失败静默
        if (r.scanned) {
          const next = await adoptCloudCovers(io, get().catalog).catch(() => null)
          if (next) set({ index: next })
        }
      })
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

  resolveEntry: async (entry) => {
    // 真实条目：路径来自 WebDAV 扫描 / 镜像，直接用（文件若已被删，下载时再发现）
    if (!entry.virtual) return { kind: 'ok', entry }
    const id = entry.catalogId
    if (!id) return { kind: 'unreachable', reason: 'scan-failed' }
    if (!(await waitForWebdav())) {
      return { kind: 'unreachable', reason: useConfigStore.getState().webdavConfig.enabled ? 'timeout' : 'off' }
    }
    // 虚拟条目只有云端资料：要确认书在不在，必须有一次成功的扫描
    if (!get().fresh) await get().refresh()
    const s = get()
    if (!s.fresh) return { kind: 'unreachable', reason: 'scan-failed' }
    const real = findRealEntry(s.index, s.catalog, id)
    if (real) return { kind: 'ok', entry: real }
    // 扫描成功却一本书都没扫到，多半是目录配错了：不能据此断定这本书被删了
    const anyReal = Object.values(s.index.entries).some((e) => !e.virtual)
    return anyReal ? { kind: 'missing', entry } : { kind: 'unreachable', reason: 'scan-failed' }
  },

  askRemove: (entry) => set({ missing: entry }),

  removeBooks: async (entries) => {
    const ids = [...new Set(entries.map((e) => e.catalogId).filter((x): x is string => !!x))]
    const deleted = new Set(ids.length ? await deleteCovers(ids) : [])
    // 云端删失败的那些保留，下次还会提示；只清理确实删掉的（或本来就没有云端条目的真实条目）
    const gone = entries.filter((e) => !e.catalogId || deleted.has(e.catalogId))
    if (deleted.size) {
      const catalog = { ...get().catalog }
      for (const id of deleted) delete catalog[id]
      set({ catalog })
    }
    const io = createLibraryIO()
    const realPaths = gone.filter((e) => !e.virtual).map((e) => e.path)
    if (io && realPaths.length) {
      const cur = migrateIndex(await io.readMirror().catch(() => null))
      if (cur) {
        const entriesMap = { ...cur.entries }
        for (const p of realPaths) delete entriesMap[p]
        const next = await persistIndex(io, { ...cur, entries: entriesMap }, realPaths).catch(() => null)
        if (next) set({ index: next })
      }
      void io.deleteCovers(gone.map((e) => e.coverKey).filter((k): k is string => !!k && !isCloudCoverKey(k))).catch(() => {})
    }
    set({ missing: null })
    return gone.length
  },

  // 要下载整本书（流量不小），只在用户点击时运行；并发 4、可取消
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

  contributeOpened: async (entry, file) => {
    const io = createLibraryIO()
    if (!io) return
    const id = entry.catalogId ?? bookIdOf(entry.path)
    const item = get().catalog[id]
    // 书变了（大小和云端记录不一致）→ 重新提取；信息不全（缺封面 / 分类 / 文件名）→ 补齐；否则什么都不用做
    const changed = !!item?.size && item.size !== file.size
    if (item && !changed && !isIncomplete(item)) return
    try {
      const { meta, thumb } = await inspectBook(await file.arrayBuffer(), entry.path)
      if (!thumb && !meta.title) return
      const cm = buildCatalogMeta(entry.path, file.size, meta, entry.title)
      const wantCover = !!thumb && (changed || !item?.cover)
      if (wantCover) await io.putLocalCover(id, thumb!)
      // 上传是尽力而为的附带动作：先乐观更新本地目录，失败也不影响本机
      void uploadCover(id, cm, wantCover ? thumb : null, fetch, { replace: changed })
      set({ catalog: { ...get().catalog, [id]: { ...item, ...cm, ...(wantCover || item?.cover ? { cover: 1 as const } : {}) } } })
      const next = await recordMetadataBatch(io, [
        { path: entry.path, patch: { title: cm.title, author: cm.author, pages: cm.pages, ...(wantCover ? { coverKey: id } : {}), stale: false } },
      ]).catch(() => null)
      if (next) set({ index: next })
    } catch (e) {
      logger.warn('[library] 打开时解析封面失败', e)
    }
  },

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
/** 阅读进度同步：同样尽力而为，失败静默（进度只是体验，不值得打断阅读） */
export function syncLibraryProgress(fileName: string, chapterId: string, pct: number): void {
  const io = createLibraryIO()
  if (!io) return
  void recordProgressByFileName(io, fileName, chapterId, pct)
    .then((idx) => {
      if (idx) useLibraryStore.setState({ index: idx })
    })
    .catch((e) => logger.warn('[library] 进度同步失败', e))
}

export function syncLibraryStatus(fileName: string, status: BookStatus): void {
  const io = createLibraryIO()
  if (!io) return
  void recordStatusByFileName(io, fileName, status)
    .then((idx) => {
      if (idx) useLibraryStore.setState({ index: idx })
    })
    .catch((e) => logger.warn('[library] 状态同步失败', e))
}
