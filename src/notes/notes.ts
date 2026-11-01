/**
 * 划线 / 批注：纯数据与纯函数（不依赖 DOM / React / 存储）。
 *
 * 锚点只到「章节 + 原文片段 + 前后各一小段上下文」：章节 id 在重新加载后会变，
 * 所以同时记章节序号与标题，解析时先按标题、再按序号找回，找不到就当游离笔记保留（不丢）。
 */
export const NOTES_VERSION = 1
export const MAX_QUOTE = 500
export const MAX_COMMENT = 2000
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
  }
}

/** 读到的存档可能来自旧版本或被改坏：逐条清洗，坏的丢掉 */
export function sanitizeNotes(raw: unknown): Note[] {
  const file = raw as Partial<NotesFile> | null
  if (!file || file.version !== NOTES_VERSION || !Array.isArray(file.notes)) return []
  const out: Note[] = []
  const seen = new Set<string>()
  for (const n of file.notes as Partial<Note>[]) {
    if (!n || typeof n.id !== 'string' || seen.has(n.id) || typeof n.quote !== 'string' || !n.quote.trim()) continue
    seen.add(n.id)
    out.push({
      id: n.id,
      chapterId: typeof n.chapterId === 'string' ? n.chapterId : '',
      chapterIndex: Number.isInteger(n.chapterIndex) ? (n.chapterIndex as number) : -1,
      chapterTitle: typeof n.chapterTitle === 'string' ? n.chapterTitle : '',
      quote: clip(n.quote, MAX_QUOTE),
      prefix: typeof n.prefix === 'string' ? clip(n.prefix, CONTEXT_LEN) : '',
      suffix: typeof n.suffix === 'string' ? clip(n.suffix, CONTEXT_LEN) : '',
      comment: typeof n.comment === 'string' ? clip(n.comment, MAX_COMMENT) : '',
      color: n.color === 2 || n.color === 3 || n.color === 4 ? n.color : 1,
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : 0,
    })
  }
  return out
}

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

/** 按章节顺序分组，组内按创建时间；游离笔记放最后 */
export function groupNotes(notes: readonly Note[], chapters: readonly ChapterRef[]): NoteGroup[] {
  const byIndex = new Map<number, Note[]>()
  const orphans: Note[] = []
  for (const n of notes) {
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
    for (const n of g.notes) {
      lines.push(...n.quote.split('\n').map((l) => `> ${l}`))
      if (n.comment.trim()) lines.push('', n.comment.trim())
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
