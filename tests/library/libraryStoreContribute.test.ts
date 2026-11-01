/**
 * contributeOpened：用户点开一本云端没有封面的书后，解析封面与元数据，补传云端并写回书库。
 * 重点：不白传（云端已有就跳过）、无封面时不上传、解析失败静默、书名占位词不覆盖原书名。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const putLocalCover = vi.fn()
const inspectBook = vi.fn()
const recordMetadataBatch = vi.fn()
const uploadCover = vi.fn()

vi.mock('@/services/library/libraryIO', () => ({
  createLibraryIO: () => ({ putLocalCover: (...a: unknown[]) => putLocalCover(...a) }),
  readLibraryMirror: vi.fn(),
}))
vi.mock('@/services/library/libraryFill', () => ({
  inspectBook: (...a: unknown[]) => inspectBook(...a),
  fillLibraryMetadata: vi.fn(),
}))
vi.mock('@/services/library/libraryService', () => ({
  recordMetadataBatch: (...a: unknown[]) => recordMetadataBatch(...a),
  adoptCloudCovers: vi.fn(),
  rebuildLibrary: vi.fn(),
  recordOpened: vi.fn(),
  recordProgressByFileName: vi.fn(),
  recordStatusByFileName: vi.fn(),
  refreshLibrary: vi.fn(),
}))
vi.mock('@/services/library/cloudCovers', async (orig) => ({
  ...(await orig<typeof import('@/services/library/cloudCovers')>()),
  uploadCover: (...a: unknown[]) => uploadCover(...a),
}))

import { useLibraryStore } from '@/services/library/libraryStore'
import { bookIdOf } from '@/services/library/bookId'
import { emptyIndex } from '@/services/library/libraryIndex'
import type { LibraryEntry } from '@/services/library/types'

const PATH = '/EBook/门口的野蛮人 - 作者.epub'
const entry = (patch: Partial<LibraryEntry> = {}) => ({ path: PATH, title: '门口的野蛮人', ...patch }) as LibraryEntry
// jsdom 的 File 没有 arrayBuffer()，用最小桩
const file = () => ({ arrayBuffer: async () => new ArrayBuffer(3) }) as unknown as File
const thumb = () => new Blob([new Uint8Array(10)], { type: 'image/webp' })

beforeEach(() => {
  vi.clearAllMocks()
  useLibraryStore.setState({ index: emptyIndex(0) })
  recordMetadataBatch.mockResolvedValue(emptyIndex(5))
})

describe('libraryStore.contributeOpened', () => {
  it('有封面：存本地、补传云端（id 与书名主干一致）、并把 coverKey 写回书库', async () => {
    const t = thumb()
    const written = emptyIndex(99)
    recordMetadataBatch.mockResolvedValue(written)
    inspectBook.mockResolvedValue({ meta: { title: '门口的野蛮人（全本）', author: '伯勒', pages: 500 }, thumb: t })
    await useLibraryStore.getState().contributeOpened(entry(), file())

    const id = bookIdOf(PATH)
    expect(putLocalCover).toHaveBeenCalledWith(id, t)
    expect(uploadCover).toHaveBeenCalledTimes(1)
    const [uid, meta, blob] = uploadCover.mock.calls[0]
    expect(uid).toBe(id)
    expect(meta).toMatchObject({ title: '门口的野蛮人（全本）', author: '伯勒', pages: 500 })
    expect(blob).toBe(t)
    expect(recordMetadataBatch.mock.calls[0][1]).toEqual([
      { path: PATH, patch: expect.objectContaining({ coverKey: id, stale: false, author: '伯勒' }) },
    ])
    expect(useLibraryStore.getState().index).toBe(written)
  })

  it('没解析出封面但有书名：只写回元数据，不上传、不存封面', async () => {
    inspectBook.mockResolvedValue({ meta: { title: '真书名', author: 'A' }, thumb: null })
    await useLibraryStore.getState().contributeOpened(entry(), file())
    expect(uploadCover).not.toHaveBeenCalled()
    expect(putLocalCover).not.toHaveBeenCalled()
    const patch = recordMetadataBatch.mock.calls[0][1][0].patch
    expect(patch).not.toHaveProperty('coverKey')
    expect(patch.title).toBe('真书名')
  })

  it('封面与书名都没有：什么都不做', async () => {
    inspectBook.mockResolvedValue({ meta: {}, thumb: null })
    await useLibraryStore.getState().contributeOpened(entry(), file())
    expect(recordMetadataBatch).not.toHaveBeenCalled()
    expect(uploadCover).not.toHaveBeenCalled()
  })

  it('解析出的书名是「未知…」占位词：保留书库里原书名', async () => {
    inspectBook.mockResolvedValue({ meta: { title: '未知书名' }, thumb: thumb() })
    await useLibraryStore.getState().contributeOpened(entry({ title: '原书名' }), file())
    expect(recordMetadataBatch.mock.calls[0][1][0].patch.title).toBe('原书名')
    expect(uploadCover.mock.calls[0][1].title).toBe('原书名')
  })

  it('解析抛错：静默吞掉，不影响打开书', async () => {
    inspectBook.mockRejectedValue(new Error('坏 epub'))
    await expect(useLibraryStore.getState().contributeOpened(entry(), file())).resolves.toBeUndefined()
    expect(uploadCover).not.toHaveBeenCalled()
  })

  it('写回书库失败（recordMetadataBatch 拒绝）：封面仍已上传，界面索引不变', async () => {
    inspectBook.mockResolvedValue({ meta: { title: 'X' }, thumb: thumb() })
    recordMetadataBatch.mockRejectedValue(new Error('dav'))
    const before = useLibraryStore.getState().index
    await useLibraryStore.getState().contributeOpened(entry(), file())
    expect(uploadCover).toHaveBeenCalledTimes(1)
    expect(useLibraryStore.getState().index).toBe(before)
  })
})
