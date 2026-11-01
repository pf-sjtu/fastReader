/**
 * 笔记 store：本机 IndexedDB 为准（改动**立即**落盘），WebDAV 信封做跨设备同步（3 秒防抖）。
 *
 * 为什么是这个顺序：spec 要求「笔记 MUST 先写 IndexedDB，再以 3 秒防抖同步到云端」。
 * 离线（没配 WebDAV / 断网 / 写失败）都只记一笔 warn：用户照常能划线批注，
 * 恢复后下一次编辑或再次打开这本书时，bind 会把本机内容推上去。
 *
 * 删除用墓碑而不是物理删除：只在本机抹掉的话，另一台设备的旧副本会在下次同步时把它复活。
 */
import { create } from 'zustand'
import { createStore, get, set } from 'idb-keyval'
import { artifactPath, buildEnvelope, loadArtifactResult, saveArtifact, syncContextFor, type ArtifactIO, type ArtifactLoad, type SyncContext } from '@/services/artifacts'
import { cloudCacheService } from '@/services/cloudCacheService'
import { webdavService } from '@/services/webdavService'
import { logger } from '@/lib/logger'
import {
  NOTES_VERSION,
  markDeleted,
  mergeNotes,
  notesEqual,
  sanitizeNotes,
  visibleNotes,
  type Note,
  type NotesFile,
} from './notes'

/** 云同步防抖：3 秒内的连续改动只写一次云端 */
export const NOTES_SYNC_DEBOUNCE_MS = 3000

export interface NotesBackend {
  load(key: string): Promise<unknown>
  save(key: string, file: NotesFile): Promise<void>
}

/** 云端同步的最小接口：生产实现见 `createNotesArtifacts`，单测注入内存实现 */
export interface NotesArtifacts {
  /**
   * 读远端笔记。**必须区分「云端没有」与「没读成」**：
   * 前者可以把本机内容推上去，后者要是也当成「没有」，一次网络抖动就会拿本机旧副本盖掉云端新副本。
   */
  load(bookKey: string): Promise<ArtifactLoad<NotesFile>>
  /** 写信封（含墓碑）+ 人可读副本（只含可见笔记）；返回是否真的写成了 */
  save(bookKey: string, file: NotesFile): Promise<boolean>
}

/** 人可读副本的明文写入：信封走 gzip 的 IO，副本要给人看，所以两者分开 */
export type PlainWriter = (path: string, text: string) => Promise<boolean>

export interface NotesArtifactsOptions {
  /** 注入 IO（单测）；不传则走 `syncContextFor`——未启用 WebDAV 时自然离线 */
  io?: ArtifactIO | null
  /** 注入 IO 时的同步目录；生产路径由 `syncContextFor` 从配置里取 */
  syncPath?: string
  /** 人可读副本的明文写入；默认真实 WebDAV 上传 */
  writeText?: PlainWriter
}

const DEFAULT_SYNC_PATH = '/fastReader'

/** 人可读副本文件名：`{stem}-笔记.json`，与 `{名}-完整摘要.md` 同层，便于在网盘里直接翻 */
export const notesCopyName = (title: string, author?: string): string =>
  `${cloudCacheService.sanitizeFileName(author ? `${title} - ${author}` : title)}-笔记.json`

/** `notes:书名|作者` → `书名|作者`（信封与产物目录都用后者当书身份） */
export const bookKeyOfNotesKey = (key: string): string =>
  key.startsWith('notes:') ? key.slice('notes:'.length) : key

/** 从书身份里拆出书名 / 作者：`bookKeyOf` 的逆运算（书名按第一处分隔符切） */
export function splitBookKey(bookKey: string): { title: string; author: string } {
  const at = bookKey.indexOf('|')
  return at < 0 ? { title: bookKey, author: '' } : { title: bookKey.slice(0, at), author: bookKey.slice(at + 1) }
}

export function createNotesArtifacts(opts?: NotesArtifactsOptions): NotesArtifacts {
  /** 注入过 opts 就完全按注入的来：没给 io 视为离线，不去碰真实配置 */
  const ctxFor = (bookKey: string): SyncContext | null =>
    opts === undefined
      ? syncContextFor(bookKey)
      : opts.io
        ? { io: opts.io, syncPath: opts.syncPath ?? DEFAULT_SYNC_PATH, bookKey }
        : null

  const writeText: PlainWriter =
    opts?.writeText ??
    (async (path, text) => {
      try {
        return (await webdavService.uploadFile(path, text)).success
      } catch {
        return false
      }
    })

  // 记住读到过的信封：版本更高 / 读不懂 / 这一轮没读成时，saveArtifact 会拒绝覆盖
  const knownByBook = new Map<string, ArtifactLoad<unknown>>()

  return {
    load: async (bookKey) => {
      const ctx = ctxFor(bookKey)
      // 没配 WebDAV：不是「云端没有这份」，而是「这一轮读不到」——别推，也别覆盖
      if (!ctx) return { status: 'error', error: 'offline' }
      const parsed = await loadArtifactResult<NotesFile>('notes', ctx)
      if (parsed.status !== 'ok') {
        knownByBook.set(bookKey, parsed)
        return parsed
      }
      // 载荷版本不认识（将来加了字段 / 降级客户端）：当「更新版本」处理，只读不写
      const version = parsed.env.data?.version
      if (typeof version !== 'number' || version > NOTES_VERSION) {
        const newer: ArtifactLoad<NotesFile> = { status: 'newer', schema: parsed.env.schema + 1 }
        knownByBook.set(bookKey, newer)
        return newer
      }
      knownByBook.set(bookKey, parsed)
      return parsed
    },

    save: async (bookKey, file) => {
      const ctx = ctxFor(bookKey)
      if (!ctx) return false
      const { title, author } = splitBookKey(bookKey)
      const env = buildEnvelope<NotesFile>({
        kind: 'notes',
        bookKey,
        title,
        ...(author ? { author } : {}),
        // 用户数据没有上游指纹：笔记永远不算「过时」，不该被清理列进「已过时」
        inputsFp: '',
        data: file,
        now: notesDeps.now(),
      })
      const known = knownByBook.get(bookKey)
      const wrote = await saveArtifact(env, ctx, known)
      if (!wrote) {
        // saveArtifact 只在「云端信封版本更高」时自己告警；`write` 返回 false（PUT 失败 / 断网）是静默的，
        // 这里补一笔——否则云端同步失效时用户与排查者都拿不到任何线索
        if (known?.status !== 'newer') logger.warn('[notes] 云端信封写入失败', artifactPath(ctx.syncPath, bookKey, 'notes'))
        // 信封是权威副本：没写成（版本更高或写失败）就先不写旁路副本，免得两份内容互相矛盾
        return false
      }
      const copyPath = `${ctx.syncPath.replace(/\/+$/, '')}/${notesCopyName(title, author)}`
      const ok = await writeText(copyPath, JSON.stringify({ version: NOTES_VERSION, notes: visibleNotes(file.notes) }))
      if (!ok) logger.warn('[notes] 人可读副本写入失败', copyPath)
      return true
    },
  }
}

let kv: ReturnType<typeof createStore> | null = null
const idbStore = () => (kv ??= createStore('juhua-notes', 'books'))

/** 可替换的外部依赖（单测注入） */
export const notesDeps: {
  backend: NotesBackend
  artifacts: NotesArtifacts
  /** 时间戳来源：单测注入假时钟，保证 TTL / 合并结果确定 */
  now: () => number
} = {
  backend: {
    load: (key) => get(key, idbStore()),
    save: async (key, file) => {
      await set(key, file, idbStore())
    },
  },
  artifacts: createNotesArtifacts(),
  now: () => Date.now(),
}

export const notesKeyOf = (book: { title?: string; author?: string }) => `notes:${book.title ?? ''}|${book.author ?? ''}`

/** 待同步的书（键 = notesKey），值是该书最新的一份全量笔记 */
const pending = new Map<string, Note[]>()
let syncTimer: ReturnType<typeof setTimeout> | null = null

/** 把所有待同步的书刷出去：一本失败不影响其它几本，失败的重新排队等下次 */
const flushPending = async () => {
  const entries = [...pending.entries()]
  pending.clear()
  for (const [key, notes] of entries) {
    try {
      const ok = await notesDeps.artifacts.save(bookKeyOfNotesKey(key), { version: NOTES_VERSION, notes })
      // 写失败（断网 / PUT 失败）就留着：下次编辑或换书回来时再推，否则离线期间改的笔记要一直等到下次改动
      if (!ok) pending.set(key, notes)
    } catch (e) {
      logger.warn('[notes] 云端同步失败', key, e)
      pending.set(key, notes)
    }
  }
}

/** 防抖：每次改动都重置计时器，3 秒内的连续编辑只落一次云端 */
const scheduleSync = () => {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void flushPending().catch((e) => logger.warn('[notes] 云端同步异常', e))
  }, NOTES_SYNC_DEBOUNCE_MS)
}

interface NotesState {
  bookKey: string | null
  /** UI 看到的笔记（不含墓碑） */
  notes: Note[]
  /** 全量（含墓碑）：本机写盘与云端同步要用，UI 不要直接消费 */
  allNotes: Note[]
  /** 刚创建、等待用户写批注的笔记（笔记页签据此自动聚焦） */
  editingId: string | null
  bind: (key: string | null) => Promise<void>
  add: (note: Note, opts?: { edit?: boolean }) => void
  update: (id: string, patch: Partial<Pick<Note, 'comment' | 'color'>>) => void
  remove: (id: string) => void
  setEditing: (id: string | null) => void
}

export const useNotesStore = create<NotesState>()((setState, getState) => {
  /** 本机立即写（spec：先写本机）。失败只 warn：离线是常态，不能打断编辑 */
  const persistLocal = (key: string, notes: Note[]) => {
    void notesDeps.backend
      .save(key, { version: NOTES_VERSION, notes })
      .catch((e) => logger.warn('[notes] 本机保存失败', key, e))
  }

  /** 改动笔记的唯一出口：本机立即落盘 + 云端防抖写 */
  const commit = (notes: Note[]) => {
    setState({ notes: visibleNotes(notes), allNotes: notes })
    const key = getState().bookKey
    if (!key) return
    persistLocal(key, notes)
    pending.set(key, notes)
    scheduleSync()
  }

  return {
    bookKey: null,
    notes: [],
    allNotes: [],
    editingId: null,

    bind: async (key) => {
      if (getState().bookKey === key) return
      setState({ bookKey: key, notes: [], allNotes: [], editingId: null })
      if (!key) return

      // 1) 本机先显示：断网 / 没配 WebDAV 时用户看到的仍是自己的笔记
      let local: Note[] = []
      try {
        local = sanitizeNotes(await notesDeps.backend.load(key), notesDeps.now())
      } catch (e) {
        logger.warn('[notes] 本机读取失败', key, e)
      }
      // 加载期间已换书：丢弃，不覆盖新书
      if (getState().bookKey !== key) return
      setState({ notes: visibleNotes(local), allNotes: local })

      // 2) 再拉远端做条目级合并（尽力而为）
      const key2 = bookKeyOfNotesKey(key)
      let remote: Note[] | null = null
      const parsed = await notesDeps.artifacts.load(key2)
      // 云端是慢操作，回来时可能已经换书：丢弃
      if (getState().bookKey !== key) return

      if (parsed.status !== 'ok') {
        // 只有确知「云端还没有这份存档」（首次开启同步 / 换设备登录）才把本机内容推上去；
        // 读失败 / 读不懂 / 版本更高时什么都不做——本机内容下次再同步，绝不能反过来覆盖云端
        if (parsed.status === 'missing' && local.length) {
          pending.set(key, local)
          scheduleSync()
        }
        return
      }
      remote = sanitizeNotes(parsed.env.data, notesDeps.now())

      const merged = mergeNotes(local, remote, notesDeps.now())
      if (!notesEqual(merged, local)) {
        setState({ notes: visibleNotes(merged), allNotes: merged })
        persistLocal(key, merged)
      }
      // 本机这边更新（或有墓碑没传上去）→ 防抖写回，让云端跟上
      if (!notesEqual(merged, remote)) {
        pending.set(key, merged)
        scheduleSync()
      }
    },

    add: (note, opts) => {
      commit([...getState().allNotes, note])
      if (opts?.edit) setState({ editingId: note.id })
    },

    update: (id, patch) =>
      commit(getState().allNotes.map((n) => (n.id === id && !n.deleted ? { ...n, ...patch, updatedAt: notesDeps.now() } : n))),

    remove: (id) => {
      const current = getState().allNotes
      const target = current.find((n) => n.id === id)
      // 已经是墓碑就当删过了：重复写一次只会白白刷新 updatedAt
      if (!target || target.deleted) return
      commit(current.map((n) => (n.id === id ? markDeleted(n, notesDeps.now()) : n)))
      if (getState().editingId === id) setState({ editingId: null })
    },

    setEditing: (id) => setState({ editingId: id }),
  }
})
