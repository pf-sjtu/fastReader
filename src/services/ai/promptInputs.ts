/**
 * AIService 的 prompt 输入组装：后处理章节筛选/压缩 + 各类型模板变量
 * 变量名与回退标签与 CLI src/cli/prompts.py 一致（见 prompts/config/README.md）
 */
import type { PromptVar } from '../prompts/render'
import { isUsableText } from '../../utils/resultStatus'

/**
 * 后处理（关联/全书总结）输入策略：
 * - 现代模型多为 128k–256k+ 上下文；章节摘要后处理默认**不截断**，保证质量。
 * - 仅当摘要总字符超过安全阈值时才按比例压缩（极端长书 / 小上下文模型兜底）。
 * - 中文约 1–2 token/字，200k 字量级仍远低于 256k token 窗口的常见可用输入。
 */
export const POST_PROCESS_SOFT_LIMIT_CHARS = 200_000
export const POST_PROCESS_CONNECTIONS_SOFT_LIMIT = 50_000

/** 后处理只喂可用章节（排除失败/跳过占位与空摘要） */
export function usableChapters<T extends { summary?: string }>(chapters: T[]): Array<T & { summary: string }> {
  return chapters.filter((ch): ch is T & { summary: string } => isUsableText(ch.summary))
}

export function truncateText(text: string, maxLen: number): string {
  const s = (text || '').trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`
}

/**
 * 组装后处理用的章节列表。
 * 默认全文；仅当总长超过 softLimit 时按章均分压缩。
 */
export function prepareChapterSummariesForPostProcess(
  chapters: Array<{ title: string; summary?: string }>,
  softLimitChars = POST_PROCESS_SOFT_LIMIT_CHARS
): Array<{ index: number; title: string; summary: string }> {
  const valid = chapters.filter((ch) => (ch.summary || '').trim().length > 0)
  if (valid.length === 0) return []

  const full = valid.map((chapter, index) => ({
    index: index + 1,
    title: chapter.title,
    summary: (chapter.summary || '').trim(),
  }))

  const totalChars = full.reduce((sum, ch) => sum + ch.summary.length, 0)
  if (totalChars <= softLimitChars) {
    return full
  }

  // 极端情况：按比例压到 softLimit（保留尽量多信息）
  const per = Math.max(400, Math.floor(softLimitChars / full.length))
  console.warn(
    `[AIService] 后处理摘要总长 ${totalChars} 字超过软上限 ${softLimitChars}，按章截至约 ${per} 字`
  )
  return full.map((chapter) => ({
    ...chapter,
    summary: truncateText(chapter.summary, per),
  }))
}

// ---- 各 prompt 类型的模板变量（顺序即回退追加顺序）----

const bookTitleVar = (bookTitle: string): PromptVar => ({
  name: 'bookTitle', label: '书名', value: bookTitle, inline: true,
})

/** 章节总结 / 章节导图：{{title}} {{content}} */
export function chapterVars(title: string, content: string): PromptVar[] {
  return [
    { name: 'title', label: '章节标题', value: title, inline: true },
    { name: 'content', label: '章节内容', value: content },
  ]
}

/** 章节关联：{{chapterSummaries}} */
export function connectionVars(chapters: unknown[]): PromptVar[] {
  return [{ name: 'chapterSummaries', label: '已处理的章节列表', value: JSON.stringify(chapters) }]
}

/** 全书总结：{{bookTitle}} {{chapterInfo}} {{connections}} */
export function overallVars(bookTitle: string, chapters: unknown[], connections: string): PromptVar[] {
  return [
    bookTitleVar(bookTitle),
    { name: 'chapterInfo', label: '已处理的章节列表', value: JSON.stringify(chapters) },
    { name: 'connections', label: '章节关联分析', value: connections },
  ]
}

/** 关键图表：{{bookTitle}} {{chapterSummaries}} {{connections}} {{overallSummary}} */
export function keyChartsVars(
  bookTitle: string, chapters: unknown[], connections: string, overallSummary: string
): PromptVar[] {
  return [
    bookTitleVar(bookTitle),
    { name: 'chapterSummaries', label: '章节摘要', value: JSON.stringify(chapters) },
    { name: 'connections', label: '章节关联分析', value: connections },
    { name: 'overallSummary', label: '全书总结', value: overallSummary },
  ]
}

/** 导图箭头：{{chapterSummaries}} */
export function arrowVars(chapters: unknown[]): PromptVar[] {
  return [{ name: 'chapterSummaries', label: '章节列表', value: JSON.stringify(chapters) }]
}

/** 整书导图：{{bookTitle}} {{chapterSummaries}} */
export function combinedMindMapVars(bookTitle: string, chapters: unknown[]): PromptVar[] {
  return [bookTitleVar(bookTitle), { name: 'chapterSummaries', label: '章节列表', value: JSON.stringify(chapters) }]
}
