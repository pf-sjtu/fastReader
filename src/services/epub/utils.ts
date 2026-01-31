/**
 * EPUB 处理工具函数
 */

/**
 * 格式化章节编号，支持补零
 */
export function formatChapterNumber(index: number, total: number = 99): string {
  const digits = total >= 100 ? 3 : 2
  return index.toString().padStart(digits, '0')
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 清理和格式化文本内容
 */
export function cleanAndFormatText(text: string): string {
  let cleaned = text
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#xA0;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#\d+;/g, '')
    .replace(/&[a-zA-Z]+;/g, '')

  cleaned = cleaned
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned
}

/**
 * 清理章节标题中的HTML实体
 */
export function cleanChapterTitle(title: string): string {
  try {
    if (!title) return title

    let cleaned = title
      .replace(/&#160;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#xA0;/g, ' ')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/&#\d+;/g, '')
      .replace(/&[a-zA-Z]+;/g, '')

    cleaned = cleaned.replace(/\s+/g, ' ').trim()

    return cleaned
  } catch (error) {
    console.warn('章节标题清理失败:', error)
    return title
  }
}
