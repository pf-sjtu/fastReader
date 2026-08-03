/**
 * EPUB 处理工具函数
 */

/** 安全转为字符串（spine/toc 的 href 偶发 undefined） */
export function asHrefString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/** 去 anchor、./ 前缀并尝试 decode */
export function normalizeHref(href: unknown): string {
  let clean = asHrefString(href).split('#')[0].replace(/^\.\//, '')
  try {
    clean = decodeURIComponent(clean)
  } catch {
    // keep raw
  }
  return clean
}

/**
 * 判断 spineHref 是否指向同一资源（兼容路径前缀差异）
 */
export function hrefMatches(spineHref: unknown, tocHref: unknown): boolean {
  const spine = normalizeHref(spineHref)
  const toc = normalizeHref(tocHref)
  if (!spine || !toc) return false
  if (spine === toc) return true
  if (spine.endsWith(toc) || toc.endsWith(spine)) return true
  const fileName = toc.split('/').pop() || toc
  if (fileName && (spine === fileName || spine.endsWith('/' + fileName))) return true
  return false
}

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
