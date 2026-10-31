/**
 * 三档阅读深度：全文 / 要点 / 一句话。
 * 只替换"显示用"的章节总结，不改原始数据（实体索引、缓存、导出都仍用全文）。
 * 速读包里没有该章时保持全文——宁可多显示，也不让某一章凭空消失。
 */
import type { StudyChapter, StudyKit } from './schema'

export type ReadingDepth = 'full' | 'points' | 'oneliner'
export const READING_DEPTHS: readonly ReadingDepth[] = ['full', 'points', 'oneliner']

export interface DepthLabels {
  terms: string
}

export function renderStudyChapter(c: StudyChapter, depth: Exclude<ReadingDepth, 'full'>, labels: DepthLabels): string {
  if (depth === 'oneliner') return c.oneLiner
  const lines = [`**${c.oneLiner}**`, '', ...c.points.map((p) => `- ${p}`)]
  if (c.terms.length) {
    lines.push('', `**${labels.terms}**`, '', ...c.terms.map((t) => `- **${t.term}**：${t.definition}`))
  }
  return lines.join('\n')
}

export function applyDepth<T extends { id: string; summary?: string }>(
  chapters: readonly T[],
  kit: StudyKit | null,
  depth: ReadingDepth,
  labels: DepthLabels
): T[] {
  if (depth === 'full' || !kit) return [...chapters]
  const byId = new Map(kit.chapters.filter((c) => c.chapterId).map((c) => [c.chapterId!, c]))
  return chapters.map((ch) => {
    const entry = byId.get(ch.id)
    return entry ? { ...ch, summary: renderStudyChapter(entry, depth, labels) } : ch
  })
}

/** 速读包覆盖了多少个章节（界面据此提示"部分章节无速读卡，保持全文"） */
export function kitCoverage(chapters: readonly { id: string }[], kit: StudyKit | null): { covered: number; total: number } {
  if (!kit) return { covered: 0, total: chapters.length }
  const ids = new Set(kit.chapters.map((c) => c.chapterId).filter(Boolean))
  return { covered: chapters.filter((c) => ids.has(c.id)).length, total: chapters.length }
}
