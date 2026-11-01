/**
 * 点开虚拟条目前的解析与「找不到」的处理：
 *   ok 找到真实文件 · missing 连接正常且扫描成功却没有这本书 · unreachable 什么都不能断定
 * 核心护栏：只有「扫描成功且确实扫到了书」才会得出 missing；任何连不上 / 扫描失败 / 目录配错都只能是 unreachable。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const io = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const listeners = vi.hoisted(() => new Set<() => void>())
const persistIndex = vi.fn()
const fetchCoverIndex = vi.fn()
const deleteCovers = vi.fn()

vi.mock('@/services/library/libraryIO', () => ({ createLibraryIO: () => io.current, readLibraryMirror: vi.fn() }))
vi.mock('@/services/webdavService', () => ({
  webdavService: {
    onInitialized: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  },
}))
vi.mock('@/services/library/libraryService', () => ({
  adoptCloudCovers: vi.fn().mockResolvedValue(null),
  persistIndex: (...a: unknown[]) => persistIndex(...a),
  rebuildLibrary: vi.fn(),
  recordMetadataBatch: vi.fn(),
  recordOpened: vi.fn(),
  recordProgressByFileName: vi.fn(),
  recordStatusByFileName: vi.fn(),
  refreshLibrary: vi.fn(),
}))
vi.mock('@/services/library/cloudCovers', async (orig) => ({
  ...(await orig<typeof import('@/services/library/cloudCovers')>()),
  fetchCoverIndex: (...a: unknown[]) => fetchCoverIndex(...a),
  deleteCovers: (...a: unknown[]) => deleteCovers(...a),
}))

import { useLibraryStore } from '@/services/library/libraryStore'
import { useConfigStore } from '@/stores/configStore'
import { buildShelf } from '@/services/library/cloudCatalog'
import { bookIdOf } from '@/services/library/bookId'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'
import type { LibraryEntry, LibraryIndex } from '@/services/library/types'

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const scan = (...names: string[]): LibraryIndex =>
  applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index

const ID_X = bookIdOf('只在云端.epub')
const catalogX = { [ID_X]: { stem: '只在云端', title: '只在云端', file: '只在云端.epub', cover: 1 as const } }
const virtualX = (): LibraryEntry => Object.values(buildShelf(emptyIndex(0), catalogX).entries)[0]

const set = (s: Partial<ReturnType<typeof useLibraryStore.getState>>) => useLibraryStore.setState(s)
const state = () => useLibraryStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  io.current = { readMirror: vi.fn(), deleteCovers: vi.fn().mockResolvedValue(undefined) }
  useConfigStore.getState().setWebDAVEnabled(true)
  set({ index: emptyIndex(0), catalog: catalogX, catalogLoaded: true, fresh: false, missing: null })
})
afterEach(() => vi.useRealTimers())

describe('loadCatalog', () => {
  it('读到就设置并标记 loaded；并发调用合并成一次请求', async () => {
    set({ catalog: {}, catalogLoaded: false })
    fetchCoverIndex.mockResolvedValue(catalogX)
    await Promise.all([state().loadCatalog(), state().loadCatalog()])
    expect(fetchCoverIndex).toHaveBeenCalledTimes(1)
    expect(state().catalog).toEqual(catalogX)
    expect(state().catalogLoaded).toBe(true)
  })

  it('读取失败（返回空）不能把已有的书架清空；首次失败则保持为空但标记 loaded（不再无限「加载中」）', async () => {
    fetchCoverIndex.mockResolvedValue({})
    await state().loadCatalog()
    expect(state().catalog).toEqual(catalogX)
    set({ catalog: {}, catalogLoaded: false })
    await state().loadCatalog()
    expect(state().catalog).toEqual({})
    expect(state().catalogLoaded).toBe(true)
  })
})

describe('resolveEntry', () => {
  it('真实条目：直接可用，完全不碰 WebDAV（文件若已被删，下载时再发现）', async () => {
    const refresh = vi.fn()
    set({ refresh })
    const real = Object.values(scan('甲.epub').entries)[0]
    expect(await state().resolveEntry(real)).toEqual({ kind: 'ok', entry: real })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('虚拟条目 + WebDAV 没启用 → unreachable(off)，不会误判为「找不到」', async () => {
    io.current = null
    useConfigStore.getState().setWebDAVEnabled(false)
    expect(await state().resolveEntry(virtualX())).toEqual({ kind: 'unreachable', reason: 'off' })
  })

  it('虚拟条目 + WebDAV 一直连不上 → 超时后 unreachable(timeout)', async () => {
    vi.useFakeTimers()
    io.current = null
    const p = state().resolveEntry(virtualX())
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await p).toEqual({ kind: 'unreachable', reason: 'timeout' })
    expect(listeners.size).toBe(0) // 超时后不遗留监听
  })

  it('虚拟条目 + WebDAV 稍后连上 → 等到连上，再扫描并找到真实文件', async () => {
    io.current = null
    const real = scan('只在云端.epub')
    const refresh = vi.fn(async () => {
      set({ fresh: true, index: real })
    })
    set({ refresh })
    const p = state().resolveEntry(virtualX())
    await Promise.resolve()
    io.current = { readMirror: vi.fn() }
    listeners.forEach((fn) => fn()) // 连上了
    const r = await p
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(r.kind).toBe('ok')
    expect(r.kind === 'ok' && r.entry.path).toBe('/EBook/只在云端.epub')
  })

  it('本会话已经成功扫描过：不再重复扫描', async () => {
    const refresh = vi.fn()
    set({ refresh, fresh: true, index: scan('只在云端.epub') })
    const r = await state().resolveEntry(virtualX())
    expect(r.kind).toBe('ok')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('扫描失败（fresh 仍为 false）→ unreachable(scan-failed)：不能据此断定书被删了', async () => {
    set({ refresh: vi.fn().mockResolvedValue(undefined), fresh: false })
    expect(await state().resolveEntry(virtualX())).toEqual({ kind: 'unreachable', reason: 'scan-failed' })
  })

  it('扫描成功、扫到了别的书，却没有这一本 → missing（交给用户决定是否删 metadata）', async () => {
    const v = virtualX()
    set({ refresh: vi.fn(), fresh: true, index: scan('别的书.epub') })
    expect(await state().resolveEntry(v)).toEqual({ kind: 'missing', entry: v })
  })

  it('扫描「成功」却一本书都没扫到（多半是目录配错）→ unreachable，绝不得出 missing', async () => {
    set({ refresh: vi.fn(), fresh: true, index: emptyIndex(0) })
    expect(await state().resolveEntry(virtualX())).toEqual({ kind: 'unreachable', reason: 'scan-failed' })
  })

  it('虚拟条目缺 catalogId（理论上不会发生）：不猜，直接 unreachable', async () => {
    const v = { ...virtualX(), catalogId: undefined }
    expect((await state().resolveEntry(v)).kind).toBe('unreachable')
  })
})

describe('removeBooks / askRemove', () => {
  const mirrorWith = (...names: string[]) => {
    const m = scan(...names)
    ;(io.current!.readMirror as ReturnType<typeof vi.fn>).mockResolvedValue(m)
    return m
  }

  it('askRemove 只登记 / 清除待确认项，不做任何删除', () => {
    const v = virtualX()
    state().askRemove(v)
    expect(state().missing).toBe(v)
    state().askRemove(null)
    expect(state().missing).toBeNull()
    expect(deleteCovers).not.toHaveBeenCalled()
  })

  it('仅云端的虚拟条目：删云端条目与本地目录，不动 WebDAV 索引；待确认项清空', async () => {
    deleteCovers.mockResolvedValue([ID_X])
    set({ missing: virtualX() })
    expect(await state().removeBooks([virtualX()])).toBe(1)
    expect(deleteCovers).toHaveBeenCalledWith([ID_X])
    expect(state().catalog[ID_X]).toBeUndefined()
    expect(persistIndex).not.toHaveBeenCalled()
    expect(state().missing).toBeNull()
  })

  it('真实条目（点开后发现文件没了）：同时从书库索引里去掉，并清掉它的 WebDAV 封面缓存', async () => {
    mirrorWith('甲.epub', '乙.epub')
    const id = bookIdOf('/EBook/甲.epub')
    set({ catalog: { [id]: { stem: '甲', title: '甲', cover: 1 } } })
    deleteCovers.mockResolvedValue([id])
    persistIndex.mockImplementation(async (_io: unknown, idx: LibraryIndex) => idx)
    const real = { ...Object.values(scan('甲.epub').entries)[0], catalogId: id, coverKey: 'legacykey' }
    expect(await state().removeBooks([real])).toBe(1)
    const [, saved, removed] = persistIndex.mock.calls[0]
    expect(Object.keys((saved as LibraryIndex).entries)).toEqual(['/EBook/乙.epub']) // 乙不受影响
    expect(removed).toEqual(['/EBook/甲.epub'])
    expect(state().index).toBe(saved)
    expect(io.current!.deleteCovers).toHaveBeenCalledWith(['legacykey'])
  })

  it('云端删除失败的保留：目录与书库都不动，下次进来仍会提示（不会假装删掉了）', async () => {
    mirrorWith('甲.epub')
    const id = bookIdOf('/EBook/甲.epub')
    set({ catalog: { [id]: { stem: '甲', title: '甲' } } })
    deleteCovers.mockResolvedValue([]) // 服务端没确认
    const real = { ...Object.values(scan('甲.epub').entries)[0], catalogId: id }
    expect(await state().removeBooks([real])).toBe(0)
    expect(state().catalog[id]).toBeDefined()
    expect(persistIndex).not.toHaveBeenCalled()
  })

  it('批量：部分成功只处理成功的那些', async () => {
    const ids = [bookIdOf('甲.epub'), bookIdOf('乙.epub')]
    set({ catalog: { [ids[0]]: { stem: '甲', title: '甲' }, [ids[1]]: { stem: '乙', title: '乙' } } })
    deleteCovers.mockResolvedValue([ids[0]])
    const entries = Object.values(buildShelf(emptyIndex(0), state().catalog).entries)
    expect(await state().removeBooks(entries)).toBe(1)
    expect(Object.keys(state().catalog)).toEqual([ids[1]])
  })
})
