import { stripRichBlocks } from '@/lib/richBlocks'
/**
 * 章节结果的纯函数工具：失败标记、可用章节筛选、缓存完整性判断、单章清除。
 * 单书 hook 与批量引擎共用，第 2 波 pipeline 收敛时可直接复用。
 */
import type { Chapter } from '@/types/book'
import {
  RESULT_PREFIX,
  failedText,
  isFailedText,
  isPlaceholderText,
  isUsableText,
} from './resultStatus'

/** 章节失败：processed=false，summary 为失败占位（C3 约定） */
export function markChapterFailed(
  chapter: Pick<Chapter, 'id' | 'title' | 'content'>,
  err: unknown
): Chapter {
  return {
    id: chapter.id,
    title: chapter.title,
    content: chapter.content,
    summary: failedText(RESULT_PREFIX.chapterFailed, err),
    processed: false,
  }
}

/** 是否存在失败章节 */
export function hasFailedChapters(chapters: ReadonlyArray<{ summary?: string }>): boolean {
  return chapters.some((ch) => isFailedText(ch.summary))
}

/** 只保留有可用摘要的章节（后处理 / 缓存 / 云同步用） */
export function usableSummaryChapters<T extends { summary?: string }>(
  chapters: readonly T[]
): T[] {
  return chapters.filter((ch) => isUsableText(ch.summary))
}

/**
 * 送进下游 prompt（关联分析 / 全书综述 / 图表 / 速读 / 自测 / 问书）的章节：
 * 富内容块（mermaid / genui / html）是给读者看的，不是信息——剔除后再送模型，省 token，
 * 也避免模型把图表源码或小部件 HTML 当成书里的事实。展示、云端上传仍用原文（usableSummaryChapters）。
 */
export function promptChapters<T extends { summary?: string }>(chapters: readonly T[]): T[] {
  return usableSummaryChapters(chapters).map((ch) => {
    const stripped = stripRichBlocks(ch.summary ?? '').trim()
    return stripped === ch.summary ? ch : { ...ch, summary: stripped }
  })
}

/** 关联 / 全书总结文本若为失败占位则视为空（用于下游 prompt） */
export function usableOrEmpty(text: string | null | undefined): string {
  return isUsableText(text) ? text : ''
}

/**
 * 云端缓存是否不完整：元数据标记 isPartial，或正文残留失败占位。
 * 不完整缓存仍可展示，但不应当作完整结果（提示用户重新处理）。
 */
export function isPartialCache(input: {
  metadata?: { isPartial?: boolean } | null
  chapters: ReadonlyArray<{ summary?: string }>
  connections?: string
  overallSummary?: string
}): boolean {
  if (input.metadata?.isPartial === true) return true
  if (hasFailedChapters(input.chapters)) return true
  return isFailedText(input.connections) || isFailedText(input.overallSummary)
}

/** 云端 / 历史解析出的章节 → 结果态章节；占位章节标为未处理 */
export function toLoadedChapters(
  parsed: ReadonlyArray<{ title: string; summary: string }>,
  idPrefix: string
): Chapter[] {
  return parsed.map((ch, index) => ({
    id: `${idPrefix}-${index}`,
    title: ch.title,
    content: '',
    summary: ch.summary,
    processed: !isPlaceholderText(ch.summary),
  }))
}

/** 只清除某一章的结果，保留书级其它字段（标题、作者、图表等） */
export function clearChapterResult<T extends { chapters: Chapter[] }>(
  book: T,
  chapterId: string,
  kind: 'summary' | 'mindmap'
): T {
  let changed = false
  const chapters = book.chapters.map((ch) => {
    if (ch.id !== chapterId) return ch
    changed = true
    return kind === 'summary'
      ? { ...ch, summary: undefined, processed: false }
      : { ...ch, mindMap: undefined, processed: false }
  })
  return changed ? { ...book, chapters } : book
}
