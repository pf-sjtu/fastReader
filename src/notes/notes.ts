/**
 * 划线 / 批注：纯数据与纯函数（不依赖 DOM / React / 存储）。
 *
 * 锚点只到「章节 + 原文片段 + 前后各一小段上下文」：章节 id 在重新加载后会变，
 * 所以同时记章节序号与标题，解析时先按标题、再按序号找回，找不到就当游离笔记保留（不丢）。
 *
 * 版本 2 起：每条带 `updatedAt`（条目级合并的裁决依据），删除改成墓碑 `deleted: true`——
 * 只在本机把条目抹掉的话，另一台设备的旧副本会在下次同步时把它「复活」。
 */
export const NOTES_VERSION = 2
export const MAX_QUOTE = 500
export const MAX_COMMENT = 2000
/** 墓碑保留期：过了这段时间就不再有人拿旧副本复活它，可以从两端彻底忘掉 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000
const CONTEXT_LEN = 24

export type NoteColor = 1 | 2 | 3 | 4

export interface Note {
  id: string
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  quote: string
  prefix: string
  suffix: string
  comment: string
  color: NoteColor
  createdAt: number
  /** 最后修改时间（毫秒）：两边同 id 冲突时取大的那份 */
  updatedAt: number
  /** 墓碑：这一条被用户删了。UI / 导出 / 可读副本都必须先过 `visibleNotes` */
  deleted?: boolean
}

export interface NotesFile {
  version: typeof NOTES_VERSION
  notes: Note[]
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 由所在章节的纯文本与选中的文字求前后文；选中文字找不到时上下文留空 */
export function captureContext(chapterText: string, selected: string): { prefix: string; suffix: string } {
  const quote = squash(selected)
  const text = squash(chapterText)
  const at = quote ? text.indexOf(quote) : -1
  if (at < 0) return { prefix: '', suffix: '' }
  return {
    prefix: text.slice(Math.max(0, at - CONTEXT_LEN), at),
    suffix: text.slice(at + quote.length, at + quote.length + CONTEXT_LEN),
  }
}

export function makeNote(input: {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  selected: string
  chapterText?: string
  comment?: string
  color?: NoteColor
  now?: number
  id?: string
}): Note | null {
  const quote = clip(squash(input.selected), MAX_QUOTE)
  if (!quote) return null
  const ctx = captureContext(input.chapterText ?? '', quote)
  const createdAt = input.now ?? Date.now()
  return {
    id: input.id ?? `n${createdAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    chapterId: input.chapterId,
    chapterIndex: input.chapterIndex,
    chapterTitle: input.chapterTitle,
    quote,
    ...ctx,
    comment: clip(input.comment ?? '', MAX_COMMENT),
    color: input.color ?? 1,
    createdAt,
    // 新建即「刚改过」：否则合并时会被任何一份远端副本压掉
    updatedAt: createdAt,
  }
}

/**
 * 读到的存档可能来自旧版本（v1 没有 `updatedAt`）或被改坏：逐条清洗，坏的丢掉。
 * 同 id 只留 `updatedAt` 最大的那条——云端手工合并过的文件里可能残留重复条目。
 * `now` 只用来判墓碑是否过期，注入是为了让单测不必依赖真实时钟。
 */
export function sanitizeNotes(raw: unknown, now: number = Date.now()): Note[] {
  const file = raw as { version?: unknown; notes?: unknown } | null
  if (!file || typeof file !== 'object') return []
  // 只认 1（旧存档，缺 updatedAt）与 2（现状）；更高的版本是别的客户端写的，读不懂就别动它
  if (file.version !== 1 && file.version !== NOTES_VERSION) return []
  if (!Array.isArray(file.notes)) return []
  const byId = new Map<string, Note>()
  for (const n of file.notes as Partial<Note>[]) {
    if (!n || typeof n.id !== 'string' || typeof n.quote !== 'string' || !n.quote.trim()) continue
    const createdAt = typeof n.createdAt === 'number' ? n.createdAt : 0
    // v1 → v2 迁移：旧存档没有「最后修改」的概念，创建时间就是它
    const updatedAt = typeof n.updatedAt === 'number' ? n.updatedAt : createdAt
    const deleted = n.deleted === true
    // 墓碑过了保留期就彻底忘掉，否则云端会无限堆积垃圾
    if (deleted && now - updatedAt > TOMBSTONE_TTL_MS) continue
    const note: Note = {
      id: n.id,
      chapterId: typeof n.chapterId === 'string' ? n.chapterId : '',
      chapterIndex: Number.isInteger(n.chapterIndex) ? (n.chapterIndex as number) : -1,
      chapterTitle: typeof n.chapterTitle === 'string' ? n.chapterTitle : '',
      quote: clip(n.quote, MAX_QUOTE),
      prefix: typeof n.prefix === 'string' ? clip(n.prefix, CONTEXT_LEN) : '',
      suffix: typeof n.suffix === 'string' ? clip(n.suffix, CONTEXT_LEN) : '',
      comment: typeof n.comment === 'string' ? clip(n.comment, MAX_COMMENT) : '',
      color: n.color === 2 || n.color === 3 || n.color === 4 ? n.color : 1,
      createdAt,
      updatedAt,
      ...(deleted ? { deleted: true } : {}),
    }
    const prev = byId.get(note.id)
    if (!prev || note.updatedAt > prev.updatedAt) byId.set(note.id, note)
  }
  // 顺序固定为「先创建时间、再 id」：写入与相等比较都依赖它，不依赖 Map 的插入顺序
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 可见笔记：UI、Markdown 导出、人可读副本只看这些（墓碑是同步用的内部状态） */
export const visibleNotes = (notes: readonly Note[]): Note[] => notes.filter((n) => !n.deleted)

/**
 * 条目级合并：同 id 取 `updatedAt` 大的那份，相等时保留本机（避免无意义的写回）；
 * 不同 id 取并集。结果再过一遍 `sanitizeNotes`（含墓碑 TTL 与去重）。
 */
export function mergeNotes(local: readonly Note[], remote: readonly Note[], now: number = Date.now()): Note[] {
  const byId = new Map<string, Note>()
  for (const n of local) byId.set(n.id, n)
  for (const n of remote) {
    const prev = byId.get(n.id)
    if (!prev || n.updatedAt > prev.updatedAt) byId.set(n.id, n)
  }
  return sanitizeNotes({ version: NOTES_VERSION, notes: [...byId.values()] }, now)
}

/**
 * 两份笔记是否一致：与顺序无关，逐字段比较。用于「要不要写回」的判断，
 * 所以必须稳定——JSON.stringify 整数组会被顺序差异骗到。
 */
export function notesEqual(a: readonly Note[], b: readonly Note[]): boolean {
  if (a.length !== b.length) return false
  const key = (n: Note) =>
    [
      n.id,
      n.chapterId,
      String(n.chapterIndex),
      n.chapterTitle,
      n.quote,
      n.prefix,
      n.suffix,
      n.comment,
      String(n.color),
      String(n.createdAt),
      String(n.updatedAt),
      n.deleted ? '1' : '0',
    ].join('\u0000')
  const ka = a.map(key).sort()
  const kb = b.map(key).sort()
  return ka.every((k, i) => k === kb[i])
}

/** 墓碑副本：不物理删除，才能把「这条删了」同步到别的设备 */
export const markDeleted = (note: Note, now: number): Note => ({ ...note, deleted: true, updatedAt: now })

export interface ChapterRef {
  id: string
  title: string
}

/** 笔记 → 当前书里的章节下标：先按标题（精确，再忽略空白标点），再按原序号且序号处标题兼容；找不到 -1 */
export function resolveChapterIndex(note: Note, chapters: readonly ChapterRef[]): number {
  const loose = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  const byId = chapters.findIndex((c) => c.id === note.chapterId)
  if (byId >= 0) return byId
  const byTitle = chapters.findIndex((c) => loose(c.title) !== '' && loose(c.title) === loose(note.chapterTitle))
  if (byTitle >= 0) return byTitle
  const at = note.chapterIndex
  const t = chapters[at]
  if (t && loose(note.chapterTitle) && (loose(t.title).includes(loose(note.chapterTitle)) || loose(note.chapterTitle).includes(loose(t.title)))) return at
  return -1
}

export interface NoteGroup {
  /** 当前书中的章节；游离笔记（章节找不到）为 null */
  chapter: (ChapterRef & { index: number }) | null
  notes: Note[]
}

/** 按章节顺序分组，组内按创建时间；游离笔记放最后。墓碑不参与（调用方不用先过滤） */
export function groupNotes(notes: readonly Note[], chapters: readonly ChapterRef[]): NoteGroup[] {
  const byIndex = new Map<number, Note[]>()
  const orphans: Note[] = []
  for (const n of visibleNotes(notes)) {
    const i = resolveChapterIndex(n, chapters)
    if (i < 0) orphans.push(n)
    else byIndex.set(i, [...(byIndex.get(i) ?? []), n])
  }
  const sort = (xs: Note[]) => [...xs].sort((a, b) => a.createdAt - b.createdAt)
  const groups: NoteGroup[] = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, xs]) => ({ chapter: { ...chapters[i], index: i }, notes: sort(xs) }))
  if (orphans.length) groups.push({ chapter: null, notes: sort(orphans) })
  return groups
}

/** 导出 Markdown：书名标题，每章一节，引用块 + 批注；游离笔记单列 */
export function notesToMarkdown(bookTitle: string, groups: readonly NoteGroup[], labels: { orphan: string; untitled: string }): string {
  const lines: string[] = [`# ${bookTitle || labels.untitled}`, '']
  for (const g of groups) {
    lines.push(`## ${g.chapter ? g.chapter.title : labels.orphan}`, '')
    for (const n of visibleNotes(g.notes)) {
      lines.push(...n.quote.split('\n').map((l) => `> ${l}`))
      if (n.comment.trim()) lines.push('', n.comment.trim())
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
