/**
 * 共享状态层：三方合并规则与写入节流。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SESSION_EXPIRED_EVENT } from '../src/services/shared/api'
import {
  __resetSharedState,
  deepEqual,
  flushSection,
  loadAll,
  markDirty,
  mergeThreeWay,
  registerSection,
  useSyncStatusStore,
} from '../src/services/shared/sharedState'

describe('三方合并', () => {
  it('只有本地改过 → 用本地', () => {
    const result = mergeThreeWay({ a: 1, b: 2 }, { a: 9, b: 2 }, { a: 1, b: 2 })
    expect(result.value).toEqual({ a: 9, b: 2 })
    expect(result.conflicts).toEqual([])
  })

  it('只有远端改过 → 用远端', () => {
    const result = mergeThreeWay({ a: 1 }, { a: 1 }, { a: 5 })
    expect(result.value).toEqual({ a: 5 })
    expect(result.conflicts).toEqual([])
  })

  it('双方改不同字段 → 两边都保留', () => {
    const result = mergeThreeWay(
      { processingMode: 'summary', outputLanguage: 'zh' },
      { processingMode: 'mindmap', outputLanguage: 'zh' },
      { processingMode: 'summary', outputLanguage: 'en' }
    )
    expect(result.value).toEqual({ processingMode: 'mindmap', outputLanguage: 'en' })
    expect(result.conflicts).toEqual([])
  })

  it('双方改同一字段为不同值 → 远端胜出并记录冲突路径', () => {
    const result = mergeThreeWay({ a: 1 }, { a: 2 }, { a: 3 })
    expect(result.value).toEqual({ a: 3 })
    expect(result.conflicts).toEqual(['a'])
  })

  it('嵌套对象逐字段合并，冲突路径带层级', () => {
    const base = { webdav: { serverUrl: 'x', syncPath: '/a' } }
    const local = { webdav: { serverUrl: 'y', syncPath: '/a' } }
    const remote = { webdav: { serverUrl: 'x', syncPath: '/b' } }
    const result = mergeThreeWay(base, local, remote)
    expect(result.value).toEqual({ webdav: { serverUrl: 'y', syncPath: '/b' } })
    expect(result.conflicts).toEqual([])

    const both = mergeThreeWay(
      { webdav: { serverUrl: 'x' } },
      { webdav: { serverUrl: 'local' } },
      { webdav: { serverUrl: 'remote' } }
    )
    expect(both.value).toEqual({ webdav: { serverUrl: 'remote' } })
    expect(both.conflicts).toEqual(['webdav.serverUrl'])
  })

  it('数组视为原子值：双改时远端胜出（不做元素级合并）', () => {
    const result = mergeThreeWay(
      { providers: ['a'] },
      { providers: ['a', 'b'] },
      { providers: ['a', 'c'] }
    )
    expect(result.value).toEqual({ providers: ['a', 'c'] })
    expect(result.conflicts).toEqual(['providers'])
  })

  it('双方改成相同值不算冲突', () => {
    const result = mergeThreeWay({ a: 1 }, { a: 7 }, { a: 7 })
    expect(result.value).toEqual({ a: 7 })
    expect(result.conflicts).toEqual([])
  })

  it('deepEqual 对嵌套结构与数组有效', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })
})

interface MockState {
  rev: number
  updatedAt: string
  data: unknown
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('写入节流与冲突重试', () => {
  let remote: Record<string, MockState>
  let puts: Array<{ section: string; data: unknown; rev: string | null }>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetSharedState()
    remote = {
      processing: {
        rev: 1,
        updatedAt: 't1',
        data: { processingOptions: { processingMode: 'summary', chapterConcurrency: 3 } },
      },
    }
    puts = []

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? 'GET'

      if (url.includes('/api/state/') && method === 'PUT') {
        const section = url.split('/api/state/')[1]
        const body = JSON.parse(String(init?.body))
        const ifMatch = new Headers(init?.headers).get('If-Match')
        puts.push({ section, data: body.data, rev: ifMatch })
        const current = remote[section] ?? { rev: 0, updatedAt: 't0', data: {} }
        if (Number(ifMatch) !== current.rev) {
          return jsonResponse(
            { error: 'conflict', rev: current.rev, updatedAt: current.updatedAt, data: current.data },
            409
          )
        }
        const next = { rev: current.rev + 1, updatedAt: `t${current.rev + 1}`, data: body.data }
        remote[section] = next
        return jsonResponse({ ok: true, rev: next.rev, updatedAt: next.updatedAt })
      }

      if (url.endsWith('/api/state')) {
        return jsonResponse({
          initialized: true,
          sections: remote,
          missing: [],
        })
      }

      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __resetSharedState()
    useSyncStatusStore.getState().setStatus('idle', { conflicts: [], error: null })
  })

  it('loadAll 把服务端数据灌进 store', async () => {
    const store = { data: null as unknown }
    registerSection(
      'processing',
      {
        getData: () => store.data,
        setData: (data) => {
          store.data = data
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )

    await loadAll()
    expect(store.data).toEqual({
      processingOptions: { processingMode: 'summary', chapterConcurrency: 3 },
    })
    expect(useSyncStatusStore.getState().initialized).toBe(true)
  })

  it('多次 markDirty 只产生一次写入（防抖 + 无变化不写）', async () => {
    let data: unknown = { processingOptions: { processingMode: 'summary', chapterConcurrency: 3 } }
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()

    data = { processingOptions: { processingMode: 'summary', chapterConcurrency: 5 } }
    markDirty('processing', 0)
    markDirty('processing', 0)
    markDirty('processing', 0)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(puts.filter((p) => p.section === 'processing')).toHaveLength(1)
  })

  it('与远端一致时不写入（省 KV 写额度）', async () => {
    let data: unknown
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()
    await flushSection('processing')
    expect(puts).toHaveLength(0)
  })

  it('409 时按三方合并重试，本地未冲突字段保留', async () => {
    let data: unknown = {
      processingOptions: { processingMode: 'summary', chapterConcurrency: 3 },
    }
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()

    // 本地改 processingMode；同时远端 rev 前进并改了 chapterConcurrency
    data = { processingOptions: { processingMode: 'mindmap', chapterConcurrency: 3 } }
    remote.processing = {
      rev: 2,
      updatedAt: 't2',
      data: { processingOptions: { processingMode: 'summary', chapterConcurrency: 8 } },
    }

    await flushSection('processing')

    expect(remote.processing.rev).toBe(3)
    expect(remote.processing.data).toEqual({
      processingOptions: { processingMode: 'mindmap', chapterConcurrency: 8 },
    })
    expect(data).toEqual({ processingOptions: { processingMode: 'mindmap', chapterConcurrency: 8 } })
  })

  it('同字段双改时远端胜出并记录冲突', async () => {
    let data: unknown = { processingOptions: { chapterConcurrency: 3 } }
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()

    data = { processingOptions: { chapterConcurrency: 5 } }
    remote.processing = { rev: 2, updatedAt: 't2', data: { processingOptions: { chapterConcurrency: 9 } } }

    await flushSection('processing')

    expect((data as { processingOptions: { chapterConcurrency: number } }).processingOptions.chapterConcurrency).toBe(9)
    expect(useSyncStatusStore.getState().conflicts).toEqual(['processingOptions.chapterConcurrency'])
  })

  it('初始化向导：force 写入会把「等于默认值」的数据也写上去（否则服务端永远未初始化 → 死循环）', async () => {
    const defaults = { processingOptions: { processingMode: 'summary', chapterConcurrency: 3 } }
    const binding = {
      getData: () => defaults,
      setData: () => {},
      debounceMs: 0,
    }
    registerSection('processing', binding, { autoWrite: false })
    await loadAll()

    // 普通 flush：与远端一致 → 不写
    await flushSection('processing')
    expect(puts).toHaveLength(0)

    // force：强制写一次，服务端从 rev 0 变成 rev 1（即「已初始化」）
    await flushSection('processing', binding, { force: true })
    expect(puts).toHaveLength(1)
    expect(remote.processing.rev).toBe(2)
  })

  it('写入进行中又有新编辑：不能丢（base 必须是真正发出去的值）', async () => {
    let data: unknown = { processingOptions: { processingMode: 'summary', chapterConcurrency: 3 } }
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()

    // 让第一次 PUT 挂起，期间再改一次
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve))
    const realFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      await gate
      return realFetch(input, init)
    })

    data = { processingOptions: { processingMode: 'mindmap', chapterConcurrency: 3 } }
    const first = flushSection('processing')
    data = { processingOptions: { processingMode: 'combined-mindmap', chapterConcurrency: 3 } }
    markDirty('processing', 0)
    releaseFirst()
    await first
    // 写入进行中收到的改动会排一次 ≥300ms 的重试
    await new Promise((resolve) => setTimeout(resolve, 400))

    // 最后一次编辑最终必须落到服务端
    expect((remote.processing.data as { processingOptions: { processingMode: string } }).processingOptions.processingMode)
      .toBe('combined-mindmap')
  })

  it('写入遇到 401 广播会话失效事件（AuthGate 据此回登录页）', async () => {
    let data: unknown = { processingOptions: { processingMode: 'summary', chapterConcurrency: 3 } }
    registerSection(
      'processing',
      { getData: () => data, setData: (next) => { data = next }, debounceMs: 0 },
      { autoWrite: false }
    )
    await loadAll()

    const onExpired = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    data = { processingOptions: { processingMode: 'mindmap', chapterConcurrency: 3 } }
    await expect(flushSection('processing')).rejects.toThrow()
    expect(onExpired).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  })

  it('网络失败进入 offline 并保留本地改动', async () => {
    let data: unknown = { processingOptions: { chapterConcurrency: 3 } }
    registerSection(
      'processing',
      {
        getData: () => data,
        setData: (next) => {
          data = next
        },
        debounceMs: 0,
      },
      { autoWrite: false }
    )
    await loadAll()

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    data = { processingOptions: { chapterConcurrency: 6 } }
    await flushSection('processing')

    expect(useSyncStatusStore.getState().status).toBe('offline')
    expect(data).toEqual({ processingOptions: { chapterConcurrency: 6 } })
  })
})
