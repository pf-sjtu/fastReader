/**
 * 章节送入 AI 前的统一预处理（单书 hook 与批量引擎共用，保证两边输入一致）
 */

/** 单章送入 AI 的最大字符数；超出部分截断并以省略号标记 */
export const CHAPTER_INPUT_MAX_CHARS = 100_000

export const TRUNCATION_MARK = '...'

/** 截断过长章节正文；未超限时原样返回 */
export function prepareChapterInput(
  content: string | null | undefined,
  maxChars: number = CHAPTER_INPUT_MAX_CHARS
): string {
  const text = content ?? ''
  if (maxChars <= 0 || text.length <= maxChars) return text
  return text.substring(0, maxChars) + TRUNCATION_MARK
}
