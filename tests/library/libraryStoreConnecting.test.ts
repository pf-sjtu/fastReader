import { describe, it, expect, vi, beforeEach } from 'vitest'

const readLibraryMirror = vi.fn()
vi.mock('@/services/library/libraryIO', () => ({
  createLibraryIO: () => null, // WebDAV 还没连上
  readLibraryMirror: (...a: unknown[]) => readLibraryMirror(...a),
}))

import { useLibraryStore } from '@/services/library/libraryStore'
import { useConfigStore } from '@/stores/configStore'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const mirrorWith = (...names: string[]) =>
  applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index

beforeEach(() => {
  vi.clearAllMocks()
  useConfigStore.getState().setWebDAVEnabled(true)
  useLibraryStore.setState({ index: emptyIndex(0), unavailable: false, connecting: false, fresh: false, error: null, refreshing: false })
})

describe('libraryStore.refresh：WebDAV 还在连接', () => {
  it('已启用但没连上：先把本地镜像摆出来（标记 connecting，不是 unavailable，也不算 fresh）', async () => {
    readLibraryMirror.mockResolvedValue(mirrorWith('甲.epub', '乙.epub'))
    await useLibraryStore.getState().refresh()
    const s = useLibraryStore.getState()
    expect(s.connecting).toBe(true)
    expect(s.unavailable).toBe(false)
    expect(s.fresh).toBe(false)
    expect(Object.keys(s.index.entries).sort()).toEqual(['/EBook/乙.epub', '/EBook/甲.epub'])
  })

  it('没有镜像（首次使用）：保持空书架 + connecting，由界面显示「正在连接」而不是「没有书」', async () => {
    readLibraryMirror.mockResolvedValue(null)
    await useLibraryStore.getState().refresh()
    expect(useLibraryStore.getState()).toMatchObject({ connecting: true, unavailable: false })
    expect(Object.keys(useLibraryStore.getState().index.entries)).toEqual([])
  })

  it('界面上已有内容（比如刚扫描过）时，不用旧镜像覆盖', async () => {
    const live = mirrorWith('新.epub')
    useLibraryStore.setState({ index: live })
    readLibraryMirror.mockResolvedValue(mirrorWith('旧.epub'))
    await useLibraryStore.getState().refresh()
    expect(Object.keys(useLibraryStore.getState().index.entries)).toEqual(['/EBook/新.epub'])
  })

  it('WebDAV 没启用：unavailable，不读镜像', async () => {
    useConfigStore.getState().setWebDAVEnabled(false)
    await useLibraryStore.getState().refresh()
    expect(useLibraryStore.getState()).toMatchObject({ unavailable: true, connecting: false })
    expect(readLibraryMirror).not.toHaveBeenCalled()
  })

  it('镜像读取失败：不抛错，仍处于 connecting', async () => {
    readLibraryMirror.mockRejectedValue(new Error('idb'))
    await expect(useLibraryStore.getState().refresh()).resolves.toBeUndefined()
    expect(useLibraryStore.getState().connecting).toBe(true)
  })
})
