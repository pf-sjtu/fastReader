import { describe, it, expect } from 'vitest'
import {
  clearLibraryMirror,
  libraryIndexPath,
  rebuildLibrary,
  recordOpened,
  recordProgress,
  recordProgressByFileName,
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

describe('splitListing：书目录与同步目录分开（书在 /EBook，摘要在 /fastReader）', () => {
  it('只把书目录里的文件当书；同步目录里的摘要用来判断状态，其余 md 不算书', () => {
    const at = (dir: string, name: string): ListedFile => ({ path: `${dir}/${name}`, basename: name, size: 10, mtime: 'm' })
    const { sources, summaryNames } = splitListing(
      [at('/EBook', '甲 - 作者.epub'), at('/EBook/子目录', '乙.pdf'), at('/fastReader', '高毅_summary.md'), at('/fastReader', '甲 - 作者-完整摘要.md'), at('/EBookShelf', '丙.epub')],
      '/EBook'
    )
    // /EBookShelf 只是前缀相同，不在 /EBook 之下
    expect(sources.map((s) => s.path)).toEqual(['/EBook/甲 - 作者.epub', '/EBook/子目录/乙.pdf'])
    expect([...summaryNames]).toEqual(['甲 - 作者-完整摘要.md'])
  })

  it('没有书目录（缺省）：同步目录里的书照旧都算', () => {
    expect(splitListing([f('a.epub'), f('b.md')]).sources).toHaveLength(2)
  })
})

describe('splitListing：处理产物不是书', () => {
  it('逐章总结 {书名}_chapter_N_summary.md 不进书库；名字里碰巧带 summary 的真书不受影响', () => {
    const { sources } = splitListing([
      f('高毅资产投资思想_chapter_41_summary.md'),
      f('高毅资产投资思想_chapter_1_summary.MD'),
      f('x_chapter_3_mindmap.txt'),
      f('Annual_Summary.md'), // 没有 _chapter_N_ 结构：当作用户自己的文档
      f('chapter_notes_summary.md'),
      f('高毅资产投资思想.epub'),
    ])
    expect(sources.map((s) => s.path.split('/').pop())).toEqual(['Annual_Summary.md', 'chapter_notes_summary.md', '高毅资产投资思想.epub'])
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

  it('recordProgressByFileName：按文件名定位；进度没变不写远端；未知文件名不抛', async () => {
    const t = await seeded()
    await recordProgressByFileName(t.io, 'a.epub', 'c2', 33.4)
    const first = t.state.remote
    expect(migrateIndex(JSON.parse(first!))!.entries[`${SYNC}/a.epub`].readProgress).toEqual({ chapterId: 'c2', pct: 33 })
    await recordProgressByFileName(t.io, 'a.epub', 'c2', 33.1) // 取整后相同
    expect(t.state.remote).toBe(first)
    await recordProgressByFileName(t.io, 'a.epub', 'c3', 120)
    expect(migrateIndex(JSON.parse(t.state.remote!))!.entries[`${SYNC}/a.epub`].readProgress).toEqual({ chapterId: 'c3', pct: 100 })
    await expect(recordProgressByFileName(t.io, 'nope.epub', 'c1', 10)).resolves.toBeTruthy()
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

describe('refreshLibrary：目录扫描与读远端索引并行（9.13：每次往返 0.5–2s，串行会叠加）', () => {
  it('远端索引还没读回来时，目录扫描已经发起', async () => {
    const { io, state } = memoryIO({ files: [f('a.epub')] })
    const events: string[] = []
    let releaseRemote!: () => void
    let reads = 0
    // 只有第一次（刷新开头那次）被我们按住；写回前的重读（persistIndex）立即返回
    io.readRemote = () =>
      ++reads > 1
        ? Promise.resolve(state.remote)
        : new Promise((resolve) => {
            events.push('readRemote:start')
            releaseRemote = () => {
              events.push('readRemote:end')
              resolve(state.remote)
            }
          })
    const origList = io.listFiles
    io.listFiles = async () => {
      events.push('listFiles:start')
      return origList()
    }
    const p = refreshLibrary(io)
    await new Promise((r) => setTimeout(r, 0))
    expect([...events].sort()).toEqual(['listFiles:start', 'readRemote:start']) // 读远端还没完（没有 end），扫描已经开始
    releaseRemote()
    const r = await p
    expect(r.scanned).toBe(true)
    expect(Object.keys(r.index.entries)).toEqual([`${SYNC}/a.epub`])
  })

  it('扫描失败（发生在读远端之后）：与以前一样返回 scanned:false，保留镜像且不 GC', async () => {
    const { io, state } = memoryIO({ files: [f('a.epub')] })
    await refreshLibrary(io)
    state.listFails = true
    const r = await refreshLibrary(io)
    expect(r.scanned).toBe(false)
    expect(r.error).toContain('PROPFIND')
    expect(Object.keys(r.index.entries)).toEqual([`${SYNC}/a.epub`])
    expect(r.removed).toEqual([])
  })

  it('skipScan：不发起目录扫描', async () => {
    const { io } = memoryIO({ files: [f('a.epub')] })
    let called = 0
    const orig = io.listFiles
    io.listFiles = async () => {
      called++
      return orig()
    }
    const r = await refreshLibrary(io, { skipScan: true })
    expect(called).toBe(0)
    expect(r.scanned).toBe(false)
  })
})
