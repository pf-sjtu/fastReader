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
  useLibraryStore.setState({ index: emptyIndex(0), catalog: {} })
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

  it('没解析出封面但有书名：补传元数据（不带图片）、不存本地封面、书库条目不加 coverKey', async () => {
    inspectBook.mockResolvedValue({ meta: { title: '真书名', author: 'A', subjects: ['Business'] }, thumb: null })
    await useLibraryStore.getState().contributeOpened(entry(), file())
    expect(putLocalCover).not.toHaveBeenCalled()
    expect(uploadCover).toHaveBeenCalledTimes(1)
    const [, meta, blob, , opts] = uploadCover.mock.calls[0]
    expect(meta).toMatchObject({ title: '真书名', subjects: ['Business'], file: '门口的野蛮人 - 作者.epub' })
    expect(blob).toBeNull() // 只更新元数据
    expect(opts).toEqual({ replace: false })
    const patch = recordMetadataBatch.mock.calls[0][1][0].patch
    expect(patch).not.toHaveProperty('coverKey')
    expect(patch.title).toBe('真书名')
  })

  describe('云端条目的更新生命周期', () => {
    const id = bookIdOf(PATH)
    const complete = { stem: 's', title: 'T', file: 'f.epub', size: 3, subjects: ['Business'], cover: 1 as const }
    const sized = (n: number) => ({ ...file(), size: n }) as unknown as File

    it('云端条目完整且文件大小一致：什么都不做（不解析、不上传、不烧写入额度）', async () => {
      useLibraryStore.setState({ catalog: { [id]: complete } })
      await useLibraryStore.getState().contributeOpened(entry(), sized(3))
      expect(inspectBook).not.toHaveBeenCalled()
      expect(uploadCover).not.toHaveBeenCalled()
    })

    it('云端条目缺分类等字段：补传元数据，但不重传已有封面', async () => {
      useLibraryStore.setState({ catalog: { [id]: { ...complete, subjects: undefined } } })
      inspectBook.mockResolvedValue({ meta: { title: 'T', subjects: ['History'] }, thumb: thumb() })
      await useLibraryStore.getState().contributeOpened(entry(), sized(3))
      const [, meta, blob, , opts] = uploadCover.mock.calls[0]
      expect(meta.subjects).toEqual(['History'])
      expect(blob).toBeNull() // 云端已有封面，不重复上传
      expect(opts).toEqual({ replace: false })
      expect(putLocalCover).not.toHaveBeenCalled()
    })

    it('文件大小和云端记录不一致（书被换了）：重新提取，并用新封面覆盖旧的', async () => {
      useLibraryStore.setState({ catalog: { [id]: complete } })
      const t = thumb()
      inspectBook.mockResolvedValue({ meta: { title: 'T' }, thumb: t })
      await useLibraryStore.getState().contributeOpened(entry(), sized(999))
      const [, meta, blob, , opts] = uploadCover.mock.calls[0]
      expect(meta.size).toBe(999)
      expect(blob).toBe(t)
      expect(opts).toEqual({ replace: true })
      expect(putLocalCover).toHaveBeenCalledWith(id, t)
    })

    it('上传后乐观更新本地云端目录：书架立刻用上新资料，不必等下次拉取', async () => {
      useLibraryStore.setState({ catalog: {} })
      inspectBook.mockResolvedValue({ meta: { title: 'T', subjects: ['Business'], year: 2020 }, thumb: thumb() })
      await useLibraryStore.getState().contributeOpened(entry(), sized(3))
      expect(useLibraryStore.getState().catalog[id]).toMatchObject({ title: 'T', subjects: ['Business'], year: 2020, size: 3, cover: 1 })
    })

    it('书架条目带 catalogId（模糊匹配得到）时用它做云端 id，而不是按路径重新算', async () => {
      inspectBook.mockResolvedValue({ meta: { title: 'T' }, thumb: thumb() })
      await useLibraryStore.getState().contributeOpened(entry({ catalogId: 'bk_fuzzy1' }), sized(3))
      expect(uploadCover.mock.calls[0][0]).toBe('bk_fuzzy1')
    })
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
