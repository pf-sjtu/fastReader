import { describe, it, expect } from 'vitest'
import {
  clearLibraryMirror,
  libraryIndexPath,
  rebuildLibrary,
  recordOpened,
  recordProgress,
  recordStatusByFileName,
  refreshLibrary,
  splitListing,
  type LibraryIO,
  type ListedFile,
} from '@/services/library/libraryService'
import { migrateIndex } from '@/services/library/libraryIndex'

const SYNC = '/fastReader'
const f = (name: string, size = 10, mtime = 'm'): ListedFile => ({ path: `${SYNC}/${name}`, basename: name, size, mtime })

/** 内存 IO：可注入"列目录失败/远端读失败"，并记录写入次数 */
function memoryIO(initial: { files?: ListedFile[]; remote?: string | null; mirror?: unknown } = {}) {
  const state = {
    files: initial.files ?? [],
    remote: initial.remote ?? null,
    mirror: initial.mirror ?? null,
    listFails: false,
    remoteReadFails: false,
    remoteWrites: 0,
    clock: 1000,
  }
  const io: LibraryIO = {
    scopeKey: 'test',
    syncPath: SYNC,
    readMirror: async () => state.mirror,
    writeMirror: async (i) => {
      state.mirror = i
    },
    readRemote: async () => {
      if (state.remoteReadFails) throw new Error('remote down')
      return state.remote
    },
    writeRemote: async (t) => {
      state.remoteWrites++
      state.remote = t
    },
    listFiles: async () => {
      if (state.listFails) throw new Error('PROPFIND 失败')
      return state.files
    },
    summaryNameOf: (n) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`,
    readBinary: async () => new ArrayBuffer(0),
    writeBinary: async () => {},
    getLocalCover: async () => null,
    putLocalCover: async () => {},
    deleteCovers: async () => {},
    now: () => ++state.clock,
  }
  return { io, state }
}

describe('splitListing', () => {
  it('摘要与内部目录不当作书', () => {
    const { sources, summaryNames } = splitListing([
      f('a.epub'),
      f('a-完整摘要.md'),
      { path: `${SYNC}/.juhua/covers/x.md`, basename: 'x.md', size: 1, mtime: '' },
      f('笔记.md'),
      f('a-完整摘要.json'),
      f('cover.png'),
    ])
    expect(sources.map((s) => s.path)).toEqual([`${SYNC}/a.epub`, `${SYNC}/笔记.md`])
    expect([...summaryNames]).toEqual(['a-完整摘要.md'])
  })
})

describe('refreshLibrary', () => {
  it('首次：扫描建索引，写镜像与远端（gzip 存于 .juhua/library.json.gz）', async () => {
    const { io, state } = memoryIO({ files: [f('a.epub'), f('b.epub'), f('b-完整摘要.md')] })
    const r = await refreshLibrary(io)
    expect(r.scanned).toBe(true)
    expect(r.added.sort()).toEqual([`${SYNC}/a.epub`, `${SYNC}/b.epub`])
    expect(r.index.entries[`${SYNC}/b.epub`].status).toBe('done')
    expect(state.remoteWrites).toBe(1)
    expect(migrateIndex(JSON.parse(state.remote!))!.entries[`${SYNC}/a.epub`]).toBeDefined()
    expect(libraryIndexPath(SYNC)).toBe('/fastReader/.juhua/library.json.gz')
  })

  it('分阶段回调：镜像先于扫描，界面可先画出旧数据', async () => {
    const first = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(first.io)
    const phases: string[] = []
    const second = memoryIO({ files: [f('a.epub')], mirror: first.state.mirror, remote: first.state.remote })
    await refreshLibrary(second.io, { onUpdate: (_i, p) => phases.push(p) })
    expect(phases).toEqual(['mirror', 'remote', 'scan'])
  })

  it('扫描失败：保留已有索引、不做 GC、scanned=false 并带错误', async () => {
    const a = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(a.io)
    a.state.listFails = true
    a.state.files = [] // 即使目录"看起来空了"也不能据此删书
    const r = await refreshLibrary(a.io)
    expect(r.scanned).toBe(false)
    expect(r.error).toContain('PROPFIND')
    expect(Object.keys(r.index.entries)).toEqual([`${SYNC}/a.epub`])
    expect(r.index.entries[`${SYNC}/a.epub`].missingScans).toBe(0)
  })

  it('GC 回归：连续两次缺席后真正从远端索引消失（不会被远端旧副本复活）', async () => {
    const t = memoryIO({ files: [f('a.epub'), f('b.epub')] })
    await refreshLibrary(t.io)
    t.state.files = [f('b.epub')]
    const r1 = await refreshLibrary(t.io)
    expect(r1.index.entries[`${SYNC}/a.epub`].missingScans).toBe(1)
    const r2 = await refreshLibrary(t.io)
    expect(r2.removed).toEqual([`${SYNC}/a.epub`])
    expect(r2.index.entries[`${SYNC}/a.epub`]).toBeUndefined()
    const remote = migrateIndex(JSON.parse(t.state.remote!))!
    expect(remote.entries[`${SYNC}/a.epub`]).toBeUndefined()
    // 再刷新一次也不会回来
    const r3 = await refreshLibrary(t.io)
    expect(r3.index.entries[`${SYNC}/a.epub`]).toBeUndefined()
  })

  it('远端索引损坏/高版本：忽略并用扫描结果重建，不抛错', async () => {
    for (const bad of ['{not json', JSON.stringify({ schemaVersion: 99, entries: {} })]) {
      const t = memoryIO({ files: [f('a.epub')], remote: bad })
      const r = await refreshLibrary(t.io)
      expect(r.scanned).toBe(true)
      expect(Object.keys(r.index.entries)).toEqual([`${SYNC}/a.epub`])
      expect(migrateIndex(JSON.parse(t.state.remote!))).not.toBeNull()
    }
  })

  it('远端读失败：用镜像继续扫描，错误信息保留给界面', async () => {
    const seed = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(seed.io)
    const t = memoryIO({ files: [f('a.epub'), f('b.epub')], mirror: seed.state.mirror })
    t.state.remoteReadFails = true
    const r = await refreshLibrary(t.io)
    expect(r.error).toContain('remote down')
    expect(r.scanned).toBe(true)
    expect(Object.keys(r.index.entries)).toHaveLength(2)
  })

  it('两台设备各自写：条目级合并，谁更新用谁，互不丢书', async () => {
    const a = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(a.io)
    // 设备 B 看到同一份远端，又多了一本
    const b = memoryIO({ files: [f('a.epub'), f('b.epub')], remote: a.state.remote })
    await refreshLibrary(b.io)
    // 设备 A 再刷新（只认识 a）：不能把 b 抹掉
    a.state.remote = b.state.remote
    a.state.files = [f('a.epub'), f('b.epub')]
    const r = await refreshLibrary(a.io)
    expect(Object.keys(r.index.entries).sort()).toEqual([`${SYNC}/a.epub`, `${SYNC}/b.epub`])
  })
})

describe('条目级更新', () => {
  async function seeded() {
    const t = memoryIO({ files: [f('a.epub'), f('a-完整摘要.md')] })
    await refreshLibrary(t.io)
    return t
  }

  it('recordOpened：写入打开时间与补全元数据，清 stale', async () => {
    const t = await seeded()
    expect((await refreshLibrary(t.io)).index.entries[`${SYNC}/a.epub`].stale).toBe(true)
    const idx = await recordOpened(t.io, `${SYNC}/a.epub`, { title: '真标题', author: '某人', chapterCount: 12 })
    expect(idx!.entries[`${SYNC}/a.epub`]).toMatchObject({ title: '真标题', author: '某人', chapterCount: 12, stale: false })
    expect(idx!.entries[`${SYNC}/a.epub`].lastOpenedAt).toBeGreaterThan(0)
    // 之后的扫描不会覆盖补全的标题
    expect((await refreshLibrary(t.io)).index.entries[`${SYNC}/a.epub`].title).toBe('真标题')
  })

  it('recordProgress：夹到 0–100 并随远端同步', async () => {
    const t = await seeded()
    await recordProgress(t.io, `${SYNC}/a.epub`, 'c3', 180)
    const remote = migrateIndex(JSON.parse(t.state.remote!))!
    expect(remote.entries[`${SYNC}/a.epub`].readProgress).toEqual({ chapterId: 'c3', pct: 100 })
  })

  it('recordStatusByFileName：按文件名定位；未知文件名/无镜像不抛错', async () => {
    const t = await seeded()
    const idx = await recordStatusByFileName(t.io, 'a.epub', 'unprocessed')
    expect(idx!.entries[`${SYNC}/a.epub`]).toMatchObject({ status: 'unprocessed' })
    expect(idx!.entries[`${SYNC}/a.epub`].summaryFile).toBeUndefined()
    await expect(recordStatusByFileName(t.io, 'nope.epub', 'done')).resolves.toBeTruthy()
    const empty = memoryIO()
    await expect(recordOpened(empty.io, '/x', { title: 'x' })).resolves.toBeNull()
  })
})

describe('重建与清理', () => {
  it('rebuildLibrary：丢弃旧索引（含已读进度），按目录重新来过', async () => {
    const t = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(t.io)
    await recordProgress(t.io, `${SYNC}/a.epub`, 'c5', 50)
    const r = await rebuildLibrary(t.io)
    expect(r.index.entries[`${SYNC}/a.epub`].readProgress).toBeUndefined()
    expect(r.added).toEqual([`${SYNC}/a.epub`])
  })

  it('clearLibraryMirror 只清本地镜像，远端索引保留', async () => {
    const t = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(t.io)
    await clearLibraryMirror(t.io)
    expect(t.state.mirror).toBeNull()
    expect(t.state.remote).not.toBeNull()
    // 之后刷新仍能从远端找回
    const r = await refreshLibrary(t.io, { skipScan: true })
    expect(Object.keys(r.index.entries)).toHaveLength(1)
  })
})
