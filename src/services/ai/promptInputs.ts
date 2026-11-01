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
  // 按章均分；不设每章保底（原先保底 400 字会让「章节数 × 400」超出小窗口模型的上限）
  const per = Math.max(1, Math.floor(softLimitChars / full.length))
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

/** 全书实体表：模板未引用时按「标签: 值」追加在末尾；没有实体表则不发送 */
export function entityTableVars(table?: string): PromptVar[] {
  const value = (table || '').trim()
  return value ? [{ name: 'entityTable', label: '已知实体表（请沿用这些规范名与别名，不要另起写法）', value }] : []
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


/** 速读包：{{bookTitle}} {{chapterSummaries}} */
export function studyKitVars(bookTitle: string, chapters: unknown[]): PromptVar[] {
  return [bookTitleVar(bookTitle), { name: 'chapterSummaries', label: '章节总结', value: JSON.stringify(chapters) }]
}

/** 自测：{{bookTitle}} {{count}} {{chapterSummaries}} */
export function quizVars(bookTitle: string, count: number, chapters: unknown[]): PromptVar[] {
  return [
    bookTitleVar(bookTitle),
    { name: 'count', label: '题目数量', value: String(count), inline: true },
    { name: 'chapterSummaries', label: '章节总结', value: JSON.stringify(chapters) },
  ]
}

/** 问书：{{bookTitle}} {{overallSummary}} {{context}} {{history}} {{question}} */
export function askVars(
  bookTitle: string,
  overallSummary: string,
  context: string,
  history: string,
  question: string
): PromptVar[] {
  return [
    bookTitleVar(bookTitle),
    { name: 'overallSummary', label: '全书总结', value: overallSummary || '（无）' },
    { name: 'context', label: '相关章节', value: context || '（没有检索到相关章节）' },
    { name: 'history', label: '此前对话', value: history || '（无）' },
    { name: 'question', label: '读者的问题', value: question },
  ]
}

/**
 * 书级步骤的 map-reduce 分组：按章节顺序贪心装组，每组总结长度 ≤ limit；
 * 单章本身超限则独占一组（后面的 prepare 会按章截断）。总长不超限时只有一组。
 */
export function groupChaptersByChars<T extends { summary?: string }>(chapters: readonly T[], limit: number): T[][] {
  const groups: T[][] = []
  let cur: T[] = []
  let size = 0
  for (const ch of chapters) {
    const len = (ch.summary ?? '').trim().length
    if (cur.length > 0 && size + len > limit) {
      groups.push(cur)
      cur = []
      size = 0
    }
    cur.push(ch)
    size += len
  }
  if (cur.length) groups.push(cur)
  return groups
}

/** 富内容块修复：{{blocks}} */
export function richRepairVars(blocks: unknown[]): PromptVar[] {
  return [{ name: 'blocks', label: '待修复的块', value: JSON.stringify(blocks) }]
}
