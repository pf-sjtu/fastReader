import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { del, set as idbSet, createStore } from 'idb-keyval'
import {
  CacheService,
  LEGACY_STORAGE_KEY,
  approxBytes,
  clearLegacyLocalCache,
} from '../../src/services/cacheService'

let dbSeq = 0
const freshDb = () => `w2pipe-cache-test-${++dbSeq}`

describe('CacheService（IndexedDB + 字节 LRU）', () => {
  let clock = 1000
  const now = () => clock

  beforeEach(() => {
    clock = 1000
  })

  it('读写 / 不存在返回 null / 删除', async () => {
    const cache = new CacheService({ dbName: freshDb(), now })
    expect(await cache.get('frc1:b:summary:c1:x')).toBeNull()
    expect(await cache.set('frc1:b:summary:c1:x', '摘要')).toBe(true)
    expect(await cache.get<string>('frc1:b:summary:c1:x')).toBe('摘要')
    const map = { nodeData: { id: 'r', topic: 't' } }
    await cache.set('frc1:b:mindmap:c1:y', map)
    expect(await cache.get('frc1:b:mindmap:c1:y')).toEqual(map)
    expect(await cache.delete('frc1:b:summary:c1:x')).toBe(true)
    expect(await cache.delete('frc1:b:summary:c1:x')).toBe(false)
    expect(await cache.get('frc1:b:summary:c1:x')).toBeNull()
  })

  it('按前缀删除：整书 / 某类 / 某章互不影响', async () => {
    const cache = new CacheService({ dbName: freshDb(), now })
    await cache.set('frc1:A:summary:c1:h1', 'a1')
    await cache.set('frc1:A:summary:c2:h2', 'a2')
    await cache.set('frc1:A:connections:_:h3', 'conn')
    await cache.set('frc1:B:summary:c1:h4', 'b1')

    expect(await cache.deleteByPrefix('frc1:A:summary:c1:')).toBe(1)
    expect(await cache.get('frc1:A:summary:c2:h2')).toBe('a2')
    expect(await cache.deleteByPrefix('frc1:A:')).toBe(2)
    expect(await cache.get('frc1:A:connections:_:h3')).toBeNull()
    expect(await cache.get('frc1:B:summary:c1:h4')).toBe('b1')
    expect(await cache.deleteByPrefix('frc1:none:')).toBe(0)
  })

  it('索引落后于存储时，前缀删除仍能扫到真实键', async () => {
    const dbName = freshDb()
    const store = createStore(dbName, 'entries')
    await idbSet('frc1:Z:summary:c1:h', 'orphan', store)
    const cache = new CacheService({ dbName, now })
    expect(await cache.deleteByPrefix('frc1:Z:')).toBe(1)
  })

  it('超过字节上限按最久未访问淘汰（读取会刷新访问时间）', async () => {
    const cache = new CacheService({ dbName: freshDb(), maxBytes: 100, now })
    await cache.set('k1', 'a'.repeat(20)) // 40 bytes
    clock = 2000
    await cache.set('k2', 'b'.repeat(20))
    clock = 3000
    await cache.get('k1') // k1 变成最近访问
    clock = 4000
    await cache.set('k3', 'c'.repeat(20)) // 共 120 > 100，淘汰最久未访问 k2
    expect(await cache.get('k2')).toBeNull()
    expect(await cache.get('k1')).toBe('a'.repeat(20))
    expect(await cache.get('k3')).toBe('c'.repeat(20))
    expect(await cache.totalBytes()).toBe(80)
  })

  it('覆盖写同一键不重复计入大小；单条超上限不缓存', async () => {
    const cache = new CacheService({ dbName: freshDb(), maxBytes: 100, now })
    await cache.set('k', 'x'.repeat(10))
    await cache.set('k', 'y'.repeat(15))
    expect(await cache.totalBytes()).toBe(30)
    expect(await cache.set('big', 'z'.repeat(60))).toBe(false)
    expect(await cache.get('big')).toBeNull()
  })

  it('读取已被外部删除的键：返回 null 并清理索引', async () => {
    const dbName = freshDb()
    const cache = new CacheService({ dbName, now })
    await cache.set('k', 'v')
    await del('k', createStore(dbName, 'entries'))
    expect(await cache.get('k')).toBeNull()
    expect(await cache.totalBytes()).toBe(0)
  })

  it('新实例从持久化索引恢复大小统计', async () => {
    const dbName = freshDb()
    const a = new CacheService({ dbName, now })
    await a.set('k', 'abcd')
    const b = new CacheService({ dbName, now })
    expect(await b.totalBytes()).toBe(8)
    expect(await b.get('k')).toBe('abcd')
  })

  it('首次使用清理旧 localStorage 整份缓存（不迁移）', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '{"book_x_summary":{}}')
    const cache = new CacheService({ dbName: freshDb(), now })
    await cache.get('anything')
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
    // 访问 localStorage 抛错也不影响
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied')
      },
    })
    expect(() => clearLegacyLocalCache()).not.toThrow()
    if (orig) Object.defineProperty(globalThis, 'localStorage', orig)
  })

  it('approxBytes：字符串 / 对象 / 不可序列化', () => {
    expect(approxBytes('ab')).toBe(4)
    expect(approxBytes({ a: 1 })).toBe(14)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(approxBytes(cyclic)).toBe(0)
  })
})
