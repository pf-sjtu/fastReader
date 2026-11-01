/**
 * 笔记 store：按书存 IndexedDB（键 = 书名 + 作者），换书先加载再显示；写入只落到「发起时的那本书」。
 * 目前只在本机保存（不同步云端）。
 */
import { create } from 'zustand'
import { createStore, get, set } from 'idb-keyval'
import { NOTES_VERSION, sanitizeNotes, type Note, type NotesFile } from './notes'

export interface NotesBackend {
  load(key: string): Promise<unknown>
  save(key: string, file: NotesFile): Promise<void>
}

let kv: ReturnType<typeof createStore> | null = null
const idbStore = () => (kv ??= createStore('juhua-notes', 'books'))

/** 可替换的外部依赖（单测注入） */
export const notesDeps: { backend: NotesBackend } = {
  backend: {
    load: (key) => get(key, idbStore()),
    save: async (key, file) => {
      await set(key, file, idbStore())
    },
  },
}

export const notesKeyOf = (book: { title?: string; author?: string }) => `notes:${book.title ?? ''}|${book.author ?? ''}`

interface NotesState {
  bookKey: string | null
  notes: Note[]
  /** 刚创建、等待用户写批注的笔记（笔记页签据此自动聚焦） */
  editingId: string | null
  bind: (key: string | null) => Promise<void>
  add: (note: Note, opts?: { edit?: boolean }) => void
  update: (id: string, patch: Partial<Pick<Note, 'comment' | 'color'>>) => void
  remove: (id: string) => void
  setEditing: (id: string | null) => void
}

export const useNotesStore = create<NotesState>()((setState, getState) => {
  const persist = (notes: Note[]) => {
    const key = getState().bookKey
    if (!key) return
    void notesDeps.backend.save(key, { version: NOTES_VERSION, notes }).catch(() => {})
  }
  const commit = (notes: Note[]) => {
    setState({ notes })
    persist(notes)
  }
  return {
    bookKey: null,
    notes: [],
    editingId: null,

    bind: async (key) => {
      if (getState().bookKey === key) return
      setState({ bookKey: key, notes: [], editingId: null })
      if (!key) return
      let loaded: Note[] = []
      try {
        loaded = sanitizeNotes(await notesDeps.backend.load(key))
      } catch {
        loaded = []
      }
      // 加载期间已换书：丢弃，不覆盖新书
      if (getState().bookKey === key) setState({ notes: loaded })
    },

    add: (note, opts) => {
      commit([...getState().notes, note])
      if (opts?.edit) setState({ editingId: note.id })
    },

    update: (id, patch) => commit(getState().notes.map((n) => (n.id === id ? { ...n, ...patch } : n))),

    remove: (id) => {
      commit(getState().notes.filter((n) => n.id !== id))
      if (getState().editingId === id) setState({ editingId: null })
    },

    setEditing: (id) => setState({ editingId: id }),
  }
})
