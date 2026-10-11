import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'

const failPlan = vi.hoisted(() => ({ key: '', times: 0, error: null as unknown }))

vi.mock('idb-keyval', async (importOriginal) => {
  const real = await importOriginal<typeof import('idb-keyval')>()
  return {
    ...real,
    set: async (key: IDBValidKey, value: unknown, store?: Parameters<typeof real.set>[2]) => {
      if (key === failPlan.key && failPlan.times > 0) {
        failPlan.times--
        throw failPlan.error
      }
      return real.set(key, value, store)
    },
  }
})

import { CacheService } from '../src/services/cacheService'

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' })

describe('CacheService 配额错误处理', () => {
  it('配额错误：淘汰旧条目后重试一次成功', async () => {
    let clock = 1
    const cache = new CacheService({ dbName: 'w2pipe-quota-1', now: () => clock++ })
    await cache.set('old1', 'o'.repeat(100))
    await cache.set('old2', 'p'.repeat(100))
    Object.assign(failPlan, { key: 'new', times: 1, error: quota() })
    expect(await cache.set('new', 'n'.repeat(10))).toBe(true)
    expect(await cache.get('old1')).toBeNull() // 最久未访问的被淘汰
    expect(await cache.get('new')).toBe('n'.repeat(10))
  })

  it('重试仍失败返回 false；非配额错误直接返回 false', async () => {
    const cache = new CacheService({ dbName: 'w2pipe-quota-2' })
    Object.assign(failPlan, { key: 'k', times: 2, error: quota() })
    expect(await cache.set('k', 'v')).toBe(false)
    Object.assign(failPlan, { key: 'k2', times: 1, error: new Error('boom') })
    expect(await cache.set('k2', 'v')).toBe(false)
    expect(await cache.get('k2')).toBeNull()
  })
})
