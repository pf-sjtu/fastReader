/**
 * 命令面板与续读的纯逻辑：命令过滤排序、章节相邻、续读存档读写与解析。
 * 不依赖 React / DOM（存储用可注入的 Storage）。
 */
import { resolveChapterIndex, type ChapterRef, type Note } from '@/notes/notes'

export interface Command {
  id: string
  group: 'chapter' | 'entity' | 'tab' | 'action'
  label: string
  /** 搜索用的附加文本（别名、副标题），不显示 */
  keywords?: string
  /** 右侧弱提示 */
  hint?: string
  run: () => void
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/**
 * 过滤并排序：标签前缀 > 标签包含 > 关键词包含；同级保持原顺序。空查询返回前 limit 条原序。
 * 查询按空白拆成多个词，必须全部命中（label+keywords 合并后判断）。
 */
export function filterCommands(items: readonly Command[], query: string, limit = 50): Command[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items.slice(0, limit)
  const scored: { c: Command; score: number; i: number }[] = []
  items.forEach((c, i) => {
    const label = norm(c.label)
    const hay = norm(`${c.label}${c.keywords ?? ''}`)
    if (!terms.every((t) => hay.includes(norm(t)))) return
    const first = norm(terms[0])
    const score = label.startsWith(first) ? 0 : label.includes(first) ? 1 : 2
    scored.push({ c, score, i })
  })
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, limit).map((x) => x.c)
}

/** 上一章 / 下一章（到头不循环，返回 null） */
export function adjacentChapter(ids: readonly string[], current: string, delta: 1 | -1): string | null {
  const at = ids.indexOf(current)
  const next = at < 0 ? (delta === 1 ? 0 : -1) : at + delta
  return next >= 0 && next < ids.length ? ids[next] : null
}

/** 在页签列表里循环切换 */
export function cycleTab<T extends string>(tabs: readonly T[], current: T, delta: 1 | -1): T | null {
  if (!tabs.length) return null
  const at = tabs.indexOf(current)
  return tabs[(at < 0 ? 0 : at + delta + tabs.length) % tabs.length]
}

/* ---------- 断点续读 ---------- */

export interface ResumePoint {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  at: number
  /** 这一章内已经读进的像素（本机恢复阅读位置用；跨设备的书库索引里没有这个字段） */
  offset?: number
}

const RESUME_PREFIX = 'juhua.resume:'
export const resumeKeyOf = (book: { title?: string; author?: string }) => `${RESUME_PREFIX}${book.title ?? ''}|${book.author ?? ''}`

/** localStorage 在隐私模式 / 配额满时会抛：一律吞掉，续读只是锦上添花 */
export function saveResume(key: string, point: ResumePoint, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(key, JSON.stringify(point))
  } catch {
    /* 忽略 */
  }
}

export function loadResume(key: string, storage: Pick<Storage, 'getItem'> = localStorage): ResumePoint | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ResumePoint>
    if (!p || typeof p.chapterId !== 'string' || typeof p.chapterTitle !== 'string') return null
    return {
      chapterId: p.chapterId,
      chapterIndex: Number.isInteger(p.chapterIndex) ? (p.chapterIndex as number) : -1,
      chapterTitle: p.chapterTitle,
      at: typeof p.at === 'number' ? p.at : 0,
      ...(typeof p.offset === 'number' && Number.isFinite(p.offset) && p.offset > 0 ? { offset: Math.min(p.offset, 200000) } : {}),
    }
  } catch {
    return null
  }
}

/**
 * 跨设备续读：本机没有续读点（换了设备 / 清了浏览器数据）时，退回书库索引里随 WebDAV 同步的阅读章节。
 * 只在本机没有时用：本机的续读点更新（含 `at` 时间戳），不会被别处较旧的进度覆盖。
 * 索引里只有章节 id（没有标题 / 序号），所以只能按 id 找回；id 对不上就当没有。
 */
export function libraryResumePoint(progress: { chapterId: string } | undefined | null): ResumePoint | null {
  return progress?.chapterId ? { chapterId: progress.chapterId, chapterIndex: -1, chapterTitle: '', at: 0 } : null
}

/** 续读点 → 当前书里的章节 id（复用笔记的章节找回：id → 标题 → 序号+标题兼容）；找不到 null */
export function resolveResume(point: ResumePoint | null, chapters: readonly ChapterRef[]): string | null {
  if (!point) return null
  const i = resolveChapterIndex(point as unknown as Note, chapters)
  return i >= 0 ? chapters[i].id : null
}
