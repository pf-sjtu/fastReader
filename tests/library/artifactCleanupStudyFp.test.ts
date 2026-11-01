/**
 * touchStudyFp：打开书的那一侧手里只有 `title|author`（信封口径的书身份），没有索引里的文件路径。
 * 用它把「各章总结指纹」写进书库条目，清理时的「已过时」判定就靠这个指纹比对信封里的 inputsFp。
 *
 * 重点（都关系到清理安全）：匹配到的条目一起写、匹配不到静默、指纹没变**完全不写**（不触发远端持久化）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordStudyFpByKey = vi.fn()
vi.mock('@/services/library/libraryIO', () => ({
  createLibraryIO: () => ({ syncPath: '/fastReader' }),
  readLibraryMirror: vi.fn(),
}))
vi.mock('@/services/library/libraryService', async (orig) => ({
  ...(await orig<typeof import('@/services/library/libraryService')>()),
  recordStudyFpByKey: (...a: unknown[]) => recordStudyFpByKey(...a),
}))

import { useLibraryStore } from '@/services/library/libraryStore'
import { emptyIndex } from '@/services/library/libraryIndex'
import type { LibraryEntry, LibraryIndex } from '@/services/library/types'

const idx = (...entries: Partial<LibraryEntry>[]): LibraryIndex => ({
  ...emptyIndex(0),
  entries: Object.fromEntries(
    entries.map((e) => {
      const path = e.path ?? '/EBook/甲.epub'
      return [path, { size: 1, mtime: 'm', status: 'unread', stale: false, missingScans: 0, updatedAt: 1, ...e, path } as LibraryEntry]
    })
  ),
})

beforeEach(() => {
  vi.clearAllMocks()
  recordStudyFpByKey.mockResolvedValue(null)
  useLibraryStore.setState({ index: emptyIndex(0), catalog: {} })
})

describe('libraryStore.touchStudyFp', () => {
  it('按 `title|author` 匹配：同一本书的多个条目一起写上，并只跑一次持久化', () => {
    useLibraryStore.setState({
      index: idx({ path: '/EBook/甲.epub', title: '甲', author: '作者' }, { path: '/EBook/甲 - 副本.epub', title: '甲', author: '作者' }),
    })
    useLibraryStore.getState().touchStudyFp('甲|作者', 'study:new')

    const { entries } = useLibraryStore.getState().index
    expect(entries['/EBook/甲.epub'].studyFp).toBe('study:new')
    expect(entries['/EBook/甲 - 副本.epub'].studyFp).toBe('study:new')
    expect(recordStudyFpByKey).toHaveBeenCalledTimes(1)
    expect(recordStudyFpByKey.mock.calls[0].slice(1)).toEqual(['甲|作者', 'study:new'])
  })

  it('指纹没变：不写本机、也不触发远端持久化', () => {
    useLibraryStore.setState({ index: idx({ title: '甲', author: '作者', studyFp: 'study:new' }) })
    useLibraryStore.getState().touchStudyFp('甲|作者', 'study:new')

    expect(recordStudyFpByKey).not.toHaveBeenCalled()
  })

  it('匹配不到条目 / 没有作者时按 `title|` 匹配：静默返回，不写任何东西', () => {
    useLibraryStore.setState({ index: idx({ title: '甲', author: '作者' }) })
    useLibraryStore.getState().touchStudyFp('乙|作者', 'study:new')
    expect(recordStudyFpByKey).not.toHaveBeenCalled()

    useLibraryStore.getState().touchStudyFp('甲|', 'study:new')
    expect(recordStudyFpByKey).not.toHaveBeenCalled()
    // 同一本无作者的书：`title|` 能匹配上
    useLibraryStore.setState({ index: idx({ title: '甲' }) })
    useLibraryStore.getState().touchStudyFp('甲|', 'study:new')
    expect(recordStudyFpByKey).toHaveBeenCalledTimes(1)
  })

  it('空指纹：直接忽略（不能把条目上的旧指纹抹成空）', () => {
    useLibraryStore.setState({ index: idx({ title: '甲' }) })
    useLibraryStore.getState().touchStudyFp('甲|', '')
    expect(recordStudyFpByKey).not.toHaveBeenCalled()
    expect(useLibraryStore.getState().index.entries['/EBook/甲.epub'].studyFp).toBeUndefined()
  })

  it('远端返回权威索引时以它为准', async () => {
    const written = idx({ title: '甲', studyFp: 'study:new' })
    recordStudyFpByKey.mockResolvedValue(written)
    useLibraryStore.setState({ index: idx({ title: '甲' }) })
    useLibraryStore.getState().touchStudyFp('甲|', 'study:new')
    await vi.waitFor(() => {
      expect(useLibraryStore.getState().index).toBe(written)
    })
  })
})
