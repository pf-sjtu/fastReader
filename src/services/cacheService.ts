/**
 * 本地结果缓存（IndexedDB，idb-keyval）
 *
 * - 键由调用方构造（见 services/pipeline/cacheKeys.ts），本服务只负责存取与淘汰
 * - 键按书分组：`frc1:{bookId}:{kind}:{slot}:{hash}`，可按前缀清除整书 / 某类 / 某章
 * - 按字节近似 LRU 淘汰（上限 CACHE_MAX_BYTES）；配额错误先淘汰再重试一次
 * - 旧 localStorage 缓存（键不含模型/prompt/内容指纹）不迁移，首次使用时直接清理
 */
import { createStore, del, delMany, get, keys, set, type UseStore } from 'idb-keyval'
import { logger } from '@/lib/logger'

export const CACHE_KEY_PREFIX = 'frc1:'
export const CACHE_MAX_BYTES = 50 * 1024 * 1024
export const LEGACY_STORAGE_KEY = 'ebook-processor-cache'
const INDEX_KEY = '__index__'
const DEFAULT_DB = 'fastReader-cache'
const DEFAULT_STORE = 'entries'
const TOUCH_PERSIST_DELAY_MS = 1000

interface IndexEntry {
  size: number
  lastAccessed: number
}

export interface CacheServiceOptions {
  dbName?: string
  storeName?: string
  maxBytes?: number
  now?: () => number
}

/** 值的近似字节数（UTF-16：字符数 × 2） */
export function approxBytes(value: unknown): number {
  try {
    return (typeof value === 'string' ? value.length : JSON.stringify(value)?.length ?? 0) * 2
  } catch {
    return 0
  }
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

/** 清理旧版 localStorage 整份缓存（不迁移：旧键无版本信息，迁移可能命中错误结果） */
export function clearLegacyLocalCache(): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // 隐私模式等环境下访问 localStorage 可能抛错，忽略
  }
}

export class CacheService {
  private storeHandle: UseStore | null = null
  private readonly dbName: string
  private readonly storeName: string
  private readonly maxBytes: number
  private readonly now: () => number
  private index: Map<string, IndexEntry> | null = null
  private indexLoading: Promise<Map<string, IndexEntry>> | null = null
  private touchTimer: ReturnType<typeof setTimeout> | null = null
  private flushHookInstalled = false

  constructor(options: CacheServiceOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB
    this.storeName = options.storeName ?? DEFAULT_STORE
    this.maxBytes = options.maxBytes ?? CACHE_MAX_BYTES
    this.now = options.now ?? Date.now
  }

  /** 惰性打开 IndexedDB（模块加载时不触碰；无 IndexedDB 的环境在各操作的 try 中降级） */
  private get store(): UseStore {
    if (!this.storeHandle) {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB 不可用')
      this.storeHandle = createStore(this.dbName, this.storeName)
    }
    return this.storeHandle
  }

  private loadIndex(): Promise<Map<string, IndexEntry>> {
    if (this.index) return Promise.resolve(this.index)
    if (!this.indexLoading) {
      this.indexLoading = (async () => {
        clearLegacyLocalCache()
        let raw: Record<string, IndexEntry> | undefined
        try {
          raw = await get<Record<string, IndexEntry>>(INDEX_KEY, this.store)
        } catch (e) {
          logger.warn('[cache] 读取索引失败，按空索引处理:', e)
        }
        this.index = new Map(Object.entries(raw ?? {}))
        return this.index
      })()
    }
    return this.indexLoading
  }

  private async persistIndex(): Promise<void> {
    if (!this.index) return
    try {
      await set(INDEX_KEY, Object.fromEntries(this.index), this.store)
    } catch (e) {
      logger.warn('[cache] 写入索引失败:', e)
    }
  }

  private schedulePersistIndex(): void {
    this.installFlushOnHide()
    if (this.touchTimer) return
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null
      void this.persistIndex()
    }, TOUCH_PERSIST_DELAY_MS)
  }

  /**
   * 标签页关闭/隐藏时把挂起的索引立即落盘。
   * 否则「最后一次读取时间」会丢，LRU 淘汰顺序失真（曾表现为缓存被误淘汰）。
   */
  private installFlushOnHide(): void {
    if (this.flushHookInstalled || typeof window === 'undefined') return
    this.flushHookInstalled = true

    const flush = () => {
      if (!this.touchTimer) return
      clearTimeout(this.touchTimer)
      this.touchTimer = null
      void this.persistIndex()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }

  /** 测试/卸载用：清掉挂起的索引写入 */
  flushPendingIndex(): Promise<void> {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer)
      this.touchTimer = null
    }
    return this.persistIndex()
  }

  /** 当前索引中的总字节数 */
  async totalBytes(): Promise<number> {
    const index = await this.loadIndex()
    let total = 0
    index.forEach((e) => (total += e.size))
    return total
  }

  async get<T>(key: string): Promise<T | null> {
    const index = await this.loadIndex()
    try {
      const value = await get<T>(key, this.store)
      if (value === undefined) {
        if (index.delete(key)) this.schedulePersistIndex()
        return null
      }
      const entry = index.get(key)
      index.set(key, { size: entry?.size ?? approxBytes(value), lastAccessed: this.now() })
      this.schedulePersistIndex()
      return value
    } catch (e) {
      logger.warn('[cache] 读取失败:', e)
      return null
    }
  }

  /** 写入；返回是否成功（失败不抛，缓存是可选能力） */
  async set(key: string, value: unknown): Promise<boolean> {
    const index = await this.loadIndex()
    const size = approxBytes(value)
    if (size > this.maxBytes) {
      logger.warn('[cache] 单条超过容量上限，不缓存:', key)
      return false
    }
    // 先记下旧条目，写成功后再更新索引；失败时索引与存储保持一致
    const previous = index.get(key)
    await this.evictUntil(this.maxBytes - size)
    try {
      await set(key, value, this.store)
    } catch (e) {
      if (!isQuotaError(e)) {
        logger.warn('[cache] 写入失败:', e)
        return false
      }
      // 配额错误：淘汰约四分之一（至少腾出本条大小）后重试一次
      const total = await this.totalBytes()
      await this.evictUntil(Math.min(total * 0.75, total - size))
      try {
        await set(key, value, this.store)
      } catch (retryErr) {
        logger.warn('[cache] 淘汰后重试仍失败:', retryErr)
        if (previous) index.set(key, previous)
        else index.delete(key)
        await this.persistIndex()
        return false
      }
    }
    index.set(key, { size, lastAccessed: this.now() })
    await this.persistIndex()
    return true
  }

  /** 按最久未访问淘汰，直到总字节数 ≤ targetBytes */
  private async evictUntil(targetBytes: number): Promise<void> {
    const index = await this.loadIndex()
    let total = await this.totalBytes()
    if (total <= targetBytes) return
    const victims: string[] = []
    const ordered = [...index.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
    for (const [key, entry] of ordered) {
      if (total <= targetBytes) break
      victims.push(key)
      total -= entry.size
      index.delete(key)
    }
    if (!victims.length) return
    try {
      await delMany(victims, this.store)
    } catch (e) {
      logger.warn('[cache] 淘汰删除失败:', e)
    }
  }

  async delete(key: string): Promise<boolean> {
    const index = await this.loadIndex()
    const existed = index.delete(key)
    try {
      await del(key, this.store)
    } catch (e) {
      logger.warn('[cache] 删除失败:', e)
    }
    if (existed) await this.persistIndex()
    return existed
  }

  /** 删除某前缀下的全部条目（整书 / 某类 / 某章），返回删除条数 */
  async deleteByPrefix(prefix: string): Promise<number> {
    const index = await this.loadIndex()
    const targets = new Set([...index.keys()].filter((k) => k.startsWith(prefix)))
    try {
      // 索引可能落后于实际存储（如索引写入失败），再扫一遍真实键
      for (const k of await keys(this.store)) {
        if (typeof k === 'string' && k.startsWith(prefix)) targets.add(k)
      }
    } catch (e) {
      logger.warn('[cache] 枚举键失败:', e)
    }
    if (!targets.size) return 0
    targets.forEach((k) => index.delete(k))
    try {
      await delMany([...targets], this.store)
    } catch (e) {
      logger.warn('[cache] 批量删除失败:', e)
    }
    await this.persistIndex()
    return targets.size
  }
}

export const cacheService = new CacheService()
