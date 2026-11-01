import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_SCHEMA,
  artifactDirOf,
  artifactPath,
  buildEnvelope,
  parseEnvelopeText,
  type ArtifactEntry,
  type ArtifactIO,
  type ArtifactLoad,
} from '@/services/artifacts'
import {
  NOTES_VERSION,
  TOMBSTONE_TTL_MS,
  markDeleted,
  mergeNotes,
  notesEqual,
  sanitizeNotes,
  visibleNotes,
  type Note,
  type NotesFile,
} from '@/notes/notes'
import {
  NOTES_SYNC_DEBOUNCE_MS,
  bookKeyOfNotesKey,
  createNotesArtifacts,
  notesCopyName,
  notesDeps,
  useNotesStore,
  type NotesArtifacts,
} from '@/notes/notesStore'

/** 内存 IO：与 tests/artifacts.test.ts 的 FakeIO 同形（那份在文件内未导出，这里再来一份） */
class FakeIO implements ArtifactIO {
  files = new Map<string, string>()
  failWrite = false
  throwOnRead = false

  async read(path: string): Promise<string | null> {
    if (this.throwOnRead) throw new Error('boom')
    return this.files.get(path) ?? null
  }

  async write(path: string, text: string): Promise<boolean> {
    if (this.failWrite) return false
    this.files.set(path, text)
    return true
  }

  async list(dir: string): Promise<ArtifactEntry[]> {
    const prefix = dir.replace(/\/+$/, '') + '/'
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => ({ path: p, basename: p.slice(prefix.length), size: p.length }))
  }

  async removeDir(dir: string): Promise<boolean> {
    const prefix = dir.replace(/\/+$/, '') + '/'
    for (const p of [...this.files.keys()]) if (p.startsWith(prefix)) this.files.delete(p)
    return true
  }
}

const NOW = 1_700_000_000_000
const KEY = 'notes:人类简史|尤瓦尔'
const BOOK_KEY = '人类简史|尤瓦尔'

const note = (over: Partial<Note> = {}): Note => ({
  id: 'a',
  chapterId: 'c1',
  chapterIndex: 0,
  chapterTitle: '第一章',
  quote: '原文片段',
  prefix: '',
  suffix: '',
  comment: '',
  color: 1,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
})

/** 假本机存储：记录写入顺序，便于断言「几时落盘、落了什么」 */
const fakeBackend = () => {
  const store = new Map<string, unknown>()
  const saves: NotesFile[] = []
  return {
    store,
    saves,
    backend: {
      load: async (key: string) => store.get(key) ?? null,
      save: async (key: string, file: NotesFile) => {
        store.set(key, file)
        saves.push(file)
      },
    },
  }
}

/** 假的人可读副本写入（明文，不 gzip） */
const fakePlainWriter = () => {
  const files = new Map<string, string>()
  return {
    files,
    write: async (path: string, text: string) => {
      files.set(path, text)
      return true
    },
  }
}

const fileOf = (key: string, notes: Note[]): NotesFile => ({ version: NOTES_VERSION, notes })
const savedFile = (store: Map<string, unknown>, key: string) => store.get(key) as NotesFile

/** 云端「读到一份笔记」：store 只看 env.data，这里造最小合法信封 */
const remoteOk = (file: NotesFile): ArtifactLoad<NotesFile> => ({
  status: 'ok',
  env: buildEnvelope<NotesFile>({ kind: 'notes', bookKey: BOOK_KEY, title: '人类简史', author: '尤瓦尔', data: file, now: NOW }),
})
/** 确知云端没有这份存档 */
const MISSING: ArtifactLoad<NotesFile> = { status: 'missing' }
/** 这一轮没读成（断网 / 5xx）——绝不能被当成「云端没有」 */
const READ_FAILED: ArtifactLoad<NotesFile> = { status: 'error', error: new Error('boom') }

const flushSync = () => vi.advanceTimersByTimeAsync(NOTES_SYNC_DEBOUNCE_MS + 1)

// 整个文件共用一个假时钟：beforeEach 里要能「冲到」上个用例残留的防抖定时器
beforeAll(() => {
  vi.useFakeTimers()
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  // 冲掉上个用例遗留的防抖写（此刻依赖还是上一份，写到旧假实现里，无副作用）
  await flushSync()
  useNotesStore.setState({ bookKey: null, notes: [], allNotes: [], editingId: null })
  notesDeps.now = () => NOW
})

describe('笔记清洗：v1 迁移与墓碑', () => {
  it('v1 存档缺 updatedAt：用 createdAt 补上（迁移到 v2 语义）', () => {
    const out = sanitizeNotes({ version: 1, notes: [{ id: 'a', quote: 'q', createdAt: 123 }] }, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].updatedAt).toBe(123)
    expect(out[0].deleted).toBeUndefined()
  })

  it('v1 与 v2 都读；其它版本 / 非对象读不懂就当没有', () => {
    expect(sanitizeNotes({ version: NOTES_VERSION, notes: [{ id: 'a', quote: 'q', createdAt: 1 }] }, NOW)).toHaveLength(1)
    expect(sanitizeNotes({ version: 99, notes: [{ id: 'a', quote: 'q' }] }, NOW)).toEqual([])
    expect(sanitizeNotes(null, NOW)).toEqual([])
    expect(sanitizeNotes({ version: NOTES_VERSION, notes: 'nope' }, NOW)).toEqual([])
  })

  it('墓碑超过保留期丢弃，未超期保留', () => {
    const tomb = (updatedAt: number) => ({
      version: NOTES_VERSION,
      notes: [{ id: 'a', quote: 'q', createdAt: 1, updatedAt, deleted: true }],
    })
    expect(sanitizeNotes(tomb(NOW - TOMBSTONE_TTL_MS - 1), NOW)).toEqual([])
    expect(sanitizeNotes(tomb(NOW - TOMBSTONE_TTL_MS + 1000), NOW)).toHaveLength(1)
  })

  it('同 id 重复条目保留 updatedAt 较新的那条（与文件里的先后顺序无关）', () => {
    const newer = note({ id: 'a', comment: '新', updatedAt: 200 })
    const older = note({ id: 'a', comment: '旧', updatedAt: 100 })
    expect(sanitizeNotes(fileOf('k', [newer, older]), NOW).map((n) => n.comment)).toEqual(['新'])
    expect(sanitizeNotes(fileOf('k', [older, newer]), NOW).map((n) => n.comment)).toEqual(['新'])
  })

  it('visibleNotes 只留可见笔记', () => {
    expect(visibleNotes([note({ id: 'a' }), markDeleted(note({ id: 'b' }), NOW)]).map((n) => n.id)).toEqual(['a'])
  })

  it('notesEqual 与顺序无关，能看出内容与墓碑差异', () => {
    const a = note({ id: 'a' })
    const b = note({ id: 'b' })
    expect(notesEqual([a, b], [b, a])).toBe(true)
    expect(notesEqual([a], [b])).toBe(false)
    expect(notesEqual([a], [markDeleted(a, 5)])).toBe(false)
  })
})

describe('条目级合并', () => {
  it('同 id 取 updatedAt 大者：远端较新取远端，本机较新取本机', () => {
    const local = [note({ comment: '本机', updatedAt: 100 })]
    const remote = [note({ comment: '远端', updatedAt: 200 })]
    expect(mergeNotes(local, remote, NOW)[0].comment).toBe('远端')
    expect(mergeNotes([note({ comment: '本机', updatedAt: 300 })], remote, NOW)[0].comment).toBe('本机')
  })

  it('updatedAt 相等时保留本机', () => {
    const merged = mergeNotes([note({ comment: '本机', updatedAt: 100 })], [note({ comment: '远端', updatedAt: 100 })], NOW)
    expect(merged[0].comment).toBe('本机')
  })

  it('墓碑压过更旧的笔记，反过来也一样', () => {
    // 时间戳要贴着 NOW：墓碑离「现在」太远会被 TTL 当成过期垃圾清掉，那是另一条规则
    const live = note({ comment: '留着', updatedAt: NOW - 2000 })
    const tomb = markDeleted(note({ updatedAt: NOW - 1000 }), NOW - 1000)
    expect(mergeNotes([live], [tomb], NOW)[0].deleted).toBe(true)
    expect(mergeNotes([tomb], [live], NOW)[0].deleted).toBe(true)
  })

  it('不同 id 取并集', () => {
    const merged = mergeNotes([note({ id: 'a' })], [note({ id: 'b' })], NOW)
    expect(merged.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('合并结果同样过墓碑 TTL：过期墓碑不会因为两边都有而复活', () => {
    const expired = markDeleted(note({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1 }), NOW - TOMBSTONE_TTL_MS - 1)
    expect(mergeNotes([expired], [expired], NOW)).toEqual([])
  })
})

describe('笔记云同步', () => {
  it('bind：先显示本机，再合并远端刷新 UI，并把合并结果写回本机', async () => {
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a', comment: '本机', updatedAt: 100 })]))
    notesDeps.backend = be.backend
    const pushed: NotesFile[] = []
    notesDeps.artifacts = {
      load: async () => remoteOk(fileOf(KEY, [note({ id: 'a', comment: '远端', updatedAt: 200 }), note({ id: 'b', updatedAt: 150 })])),
      save: async (_key, file) => {
        pushed.push(file)
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)

    const s = useNotesStore.getState()
    expect(s.bookKey).toBe(KEY)
    expect(s.notes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(s.allNotes.find((n) => n.id === 'a')?.comment).toBe('远端')
    // 合并结果与远端一致 → 不需要写回云端
    await flushSync()
    expect(pushed).toEqual([])
    // 但本机必须已经被合并结果覆盖
    expect(savedFile(be.store, KEY).notes.find((n) => n.id === 'a')?.comment).toBe('远端')
  })

  it('本机较新时：合并后 3 秒防抖把结果写回云端', async () => {
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a', comment: '本机改过', updatedAt: 300 })]))
    notesDeps.backend = be.backend
    const pushed: NotesFile[] = []
    notesDeps.artifacts = {
      load: async () => remoteOk(fileOf(KEY, [note({ id: 'a', comment: '远端旧', updatedAt: 100 })])),
      save: async (_key, file) => {
        pushed.push(file)
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)
    expect(pushed).toEqual([])
    await flushSync()
    expect(pushed).toHaveLength(1)
    expect(pushed[0].notes[0].comment).toBe('本机改过')
  })

  it('云端还没有这份存档时，把本机已有的笔记推上去（老用户第一次开启同步）', async () => {
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a' })]))
    notesDeps.backend = be.backend
    const pushed: Array<{ bookKey: string; file: NotesFile }> = []
    notesDeps.artifacts = {
      load: async () => MISSING,
      save: async (bookKey, file) => {
        pushed.push({ bookKey, file })
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)
    await flushSync()
    // 用书身份（书名|作者）而不是 notes: 前缀的存储键
    expect(pushed).toEqual([{ bookKey: BOOK_KEY, file: fileOf(KEY, [note({ id: 'a' })]) }])
  })

  it('3 秒内的多次改动只写一次云端，内容是最后一次', async () => {
    const be = fakeBackend()
    notesDeps.backend = be.backend
    const pushed: NotesFile[] = []
    notesDeps.artifacts = {
      load: async () => MISSING,
      save: async (_key, file) => {
        pushed.push(file)
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)
    expect(pushed).toEqual([])
    useNotesStore.getState().add(note({ id: 'a', comment: '一' }))
    await vi.advanceTimersByTimeAsync(1000)
    useNotesStore.getState().update('a', { comment: '二' })
    await vi.advanceTimersByTimeAsync(1000)
    useNotesStore.getState().update('a', { comment: '三' })
    // 没到 3 秒一次都没写
    expect(pushed).toEqual([])
    await flushSync()
    expect(pushed).toHaveLength(1)
    expect(pushed[0].notes[0].comment).toBe('三')
  })

  it('换书不串写：A 书的待写仍落到 A 的信封，不会写进 B 书', async () => {
    const be = fakeBackend()
    notesDeps.backend = be.backend
    const pushed: { key: string; file: NotesFile }[] = []
    notesDeps.artifacts = {
      load: async () => MISSING,
      save: async (key, file) => {
        pushed.push({ key, file })
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)
    useNotesStore.getState().add(note({ id: 'a', comment: 'A 书的批注' }))
    // 还没到 3 秒就换到另一本书：A 的改动不能因此丢掉，也不能混进 B 的书信封装
    await useNotesStore.getState().bind('notes:未来简史|尤瓦尔')
    await flushSync()

    expect(pushed).toHaveLength(1)
    expect(pushed[0].key).toBe(BOOK_KEY)
    expect(pushed[0].file.notes[0].comment).toBe('A 书的批注')
  })

  it('remove 写墓碑：UI 看不到，本机与云端都留着墓碑', async () => {
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a' })]))
    notesDeps.backend = be.backend
    const pushed: NotesFile[] = []
    notesDeps.artifacts = {
      load: async () => MISSING,
      save: async (_key, file) => {
        pushed.push(file)
        return true
      },
    }

    await useNotesStore.getState().bind(KEY)
    useNotesStore.getState().remove('a')

    expect(useNotesStore.getState().notes).toEqual([])
    expect(useNotesStore.getState().allNotes[0].deleted).toBe(true)
    expect(savedFile(be.store, KEY).notes[0].deleted).toBe(true)
    await flushSync()
    expect(pushed[0].notes[0].deleted).toBe(true)
  })

  it('云端读失败：本机照常用，之后连编辑也不推 —— 一次抖动不许拿本机旧副本盖掉云端', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a', comment: '本机' })]))
    notesDeps.backend = be.backend
    const io = new FakeIO()
    io.throwOnRead = true
    notesDeps.artifacts = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })

    await useNotesStore.getState().bind(KEY)
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(['a'])

    useNotesStore.getState().update('a', { comment: '本机改过' })
    await flushSync()
    expect(io.files.size).toBe(0) // 一封都没写出去
    // 本机照常落盘
    expect(savedFile(be.store, KEY).notes[0].comment).toBe('本机改过')
    warn.mockRestore()
  })

  it('云端信封版本更高：本机照常用，但一次都不许写回', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a' })]))
    notesDeps.backend = be.backend
    const io = new FakeIO()
    const plain = fakePlainWriter()
    notesDeps.artifacts = createNotesArtifacts({ io, syncPath: '/sync', writeText: plain.write })
    // 云端那份是「将来版本」写的（data.version 更大）
    const future = { version: NOTES_VERSION + 1, notes: [{ id: 'z', quote: 'q', createdAt: 1, updatedAt: 2 }] }
    const envPath = artifactPath('/sync', BOOK_KEY, 'notes')
    io.files.set(envPath, JSON.stringify(buildEnvelope({ kind: 'notes', bookKey: BOOK_KEY, title: '人类简史', data: future, now: NOW })))
    const before = io.files.get(envPath)

    await useNotesStore.getState().bind(KEY)
    useNotesStore.getState().add(note({ id: 'b' }))
    await flushSync()
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(io.files.get(envPath)).toBe(before) // 云端那份原封不动
    expect(plain.files.size).toBe(0) // 也没写人可读副本（免得两份内容互相矛盾）
    warn.mockRestore()
  })

  it('写失败后留在队里：另一本书的改动触发同步时，这本没改动的也会补推一次', async () => {
    const KEY_B = 'notes:未来简史|尤瓦尔'
    const be = fakeBackend()
    notesDeps.backend = be.backend
    const pushed: string[] = []
    let online = false
    notesDeps.artifacts = {
      load: async () => MISSING,
      save: async (key) => {
        pushed.push(key)
        return online
      },
    }

    await useNotesStore.getState().bind(KEY)
    useNotesStore.getState().add(note({ id: 'a', comment: 'A 书离线改动' }))
    await useNotesStore.getState().bind(KEY_B)
    useNotesStore.getState().add(note({ id: 'b', comment: 'B 书离线改动' }))
    await flushSync()
    expect(pushed).toHaveLength(2) // 两本都试过、都失败

    online = true
    useNotesStore.getState().update('b', { comment: 'B 书恢复后改动' })
    await flushSync()
    // A 这次没有任何新改动，但上次失败仍留在队里：一并补推，否则离线期间的改动要等到下次编辑才同步
    expect(pushed.filter((k) => k === BOOK_KEY)).toHaveLength(2)
  })

  it('云端：信封含墓碑，人可读副本只含可见笔记', async () => {
    const io = new FakeIO()
    const plain = fakePlainWriter()
    notesDeps.artifacts = createNotesArtifacts({ io, syncPath: '/sync', writeText: plain.write })
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a' }), note({ id: 'b' })]))
    notesDeps.backend = be.backend

    await useNotesStore.getState().bind(KEY)
    await flushSync()
    useNotesStore.getState().remove('a')
    await flushSync()

    // 信封：含墓碑，且笔记没有上游指纹（永远不算过时）
    const envText = io.files.get(`${artifactDirOf('/sync', BOOK_KEY)}/notes.json.gz`)
    expect(envText).toBeTruthy()
    const parsed = parseEnvelopeText<NotesFile>(envText as string, 'notes')
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.env.kind).toBe('notes')
    expect(parsed.env.bookKey).toBe(BOOK_KEY)
    expect(parsed.env.title).toBe('人类简史')
    expect(parsed.env.author).toBe('尤瓦尔')
    expect(parsed.env.inputsFp).toBe('')
    expect(parsed.env.data.notes.find((n) => n.id === 'a')?.deleted).toBe(true)

    // 人可读副本：明文 JSON，只含可见笔记
    const copyPath = `/sync/${notesCopyName('人类简史', '尤瓦尔')}`
    const copy = JSON.parse(plain.files.get(copyPath) as string) as NotesFile
    expect(copy.version).toBe(NOTES_VERSION)
    expect(copy.notes.map((n) => n.id)).toEqual(['b'])
  })

  it('离线（没配 WebDAV）时云端静默跳过，本机照常立即落盘', async () => {
    const be = fakeBackend()
    notesDeps.backend = be.backend
    notesDeps.artifacts = createNotesArtifacts({ io: null })
    await useNotesStore.getState().bind(KEY)

    useNotesStore.getState().add(note({ id: 'a', comment: '离线也能写' }))
    // 本机是同步写入的：不推进定时器也已经落盘
    expect(savedFile(be.store, KEY).notes.map((n) => n.id)).toEqual(['a'])
    await flushSync()
    expect(savedFile(be.store, KEY).notes[0].comment).toBe('离线也能写')
  })

  it('云端写失败只警告，本机已落盘不受影响', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    io.failWrite = true
    notesDeps.artifacts = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })
    const be = fakeBackend()
    be.store.set(KEY, fileOf(KEY, [note({ id: 'a' })]))
    notesDeps.backend = be.backend

    await useNotesStore.getState().bind(KEY)
    useNotesStore.getState().add(note({ id: 'b' }))
    await flushSync()

    expect(savedFile(be.store, KEY).notes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('读本机期间换书：旧结果丢弃，不覆盖新书', async () => {
    const KEY_A = 'notes:甲|'
    const KEY_B = 'notes:乙|'
    const be = fakeBackend()
    be.store.set(KEY_A, fileOf(KEY_A, [note({ id: 'a' })]))
    be.store.set(KEY_B, fileOf(KEY_B, [note({ id: 'b' })]))
    let releaseA: () => void = () => {}
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    notesDeps.backend = {
      load: async (key: string) => {
        if (key === KEY_A) await gateA
        return be.backend.load(key)
      },
      save: be.backend.save,
    }
    notesDeps.artifacts = { load: async () => MISSING, save: async () => true }

    const bindingA = useNotesStore.getState().bind(KEY_A)
    const bindingB = useNotesStore.getState().bind(KEY_B)
    releaseA()
    await Promise.all([bindingA, bindingB])

    expect(useNotesStore.getState().bookKey).toBe(KEY_B)
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(['b'])
  })

  it('bookKeyOfNotesKey 把存储键还原成书身份', () => {
    expect(bookKeyOfNotesKey(KEY)).toBe(BOOK_KEY)
    expect(bookKeyOfNotesKey('裸键无前缀')).toBe('裸键无前缀')
  })
})

describe('云端适配器的离线语义与危险信号', () => {
  it('注入 io 时用注入的；注入 null 视为离线（读「没读成」、写返回 false）', async () => {
    const io = new FakeIO()
    const online = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })
    expect(await online.save(BOOK_KEY, fileOf('k', [note({ id: 'a' })]))).toBe(true)
    expect(io.files.size).toBeGreaterThan(0)

    const offline: NotesArtifacts = createNotesArtifacts({ io: null })
    expect((await offline.load(BOOK_KEY)).status).toBe('error')
    await expect(offline.save(BOOK_KEY, fileOf('k', [note({ id: 'a' })]))).resolves.toBe(false)
    expect(io.files.size).toBe(1)
  })

  it('云端确实没有这份存档 → missing；这时才允许把本机内容推上去', async () => {
    const io = new FakeIO()
    const arts = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })
    expect((await arts.load(BOOK_KEY)).status).toBe('missing')
    expect(await arts.save(BOOK_KEY, fileOf('k', [note({ id: 'a' })]))).toBe(true)
    expect(io.files.size).toBe(1)
  })

  it('读失败 → error，且此后拒绝写入（本机旧副本不能盖掉云端）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    io.throwOnRead = true
    const arts = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })
    expect((await arts.load(BOOK_KEY)).status).toBe('error')
    expect(await arts.save(BOOK_KEY, fileOf('k', [note({ id: 'a' })]))).toBe(false)
    expect(io.files.size).toBe(0)
    warn.mockRestore()
  })

  it('载荷版本比本机新（data.version 更大）→ 当 newer 处理，只读不写', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    const arts = createNotesArtifacts({ io, syncPath: '/sync', writeText: fakePlainWriter().write })
    const future = { version: NOTES_VERSION + 1, notes: [{ id: 'a', quote: 'q', createdAt: 1, updatedAt: 2 }] }
    io.files.set(
      artifactPath('/sync', BOOK_KEY, 'notes'),
      JSON.stringify(buildEnvelope({ kind: 'notes', bookKey: BOOK_KEY, title: '人类简史', data: future, now: NOW })),
    )
    expect((await arts.load(BOOK_KEY)).status).toBe('newer')
    expect(await arts.save(BOOK_KEY, fileOf('k', [note({ id: 'a' })]))).toBe(false)
    warn.mockRestore()
  })
})
