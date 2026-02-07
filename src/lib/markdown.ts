const SPACE = ' '
// 标点范围：ASCII标点（不含*和_）+ Unicode标点
const PUNCTUATION_RANGES = '\u0021-\u0029\u002C-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u007E\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFFEF'

// 匹配 Markdown 强调标记及其内容：(**|__|*|_)(content)\1
const emphasisPattern = /(\*\*|__|\*|_)(.+?)\1/g

function isPunctuation(char: string): boolean {
  if (!char) return false
  const code = char.charCodeAt(0)
  // 检查是否在标点范围内
  return new RegExp(`^[${PUNCTUATION_RANGES}]$`).test(char)
}

/**
 * 为 Markdown 强调标记内部的标点符号添加词边界，避免 **"文本"** 等格式在渲染器中失效。
 * 检测标记内部是否有标点：
 * - 内部开头有标点 → 在作用域前加空格
 * - 内部末尾有标点 → 在作用域后加空格
 * 此函数作为渲染前的中间层，不影响原始 Markdown 内容本身。
 */
export function normalizeMarkdownTypography(input?: string): string {
  if (!input) {
    return ''
  }

  return input.replace(emphasisPattern, (match, marker, content) => {
    const firstChar = content.charAt(0)
    const lastChar = content.charAt(content.length - 1)

    const hasLeadingPunct = isPunctuation(firstChar)
    const hasTrailingPunct = isPunctuation(lastChar)

    // 根据内部标点位置，在作用域外添加空格
    const leadingSpace = hasLeadingPunct ? SPACE : ''
    const trailingSpace = hasTrailingPunct ? SPACE : ''

    return `${leadingSpace}${marker}${content}${marker}${trailingSpace}`
  })
}
