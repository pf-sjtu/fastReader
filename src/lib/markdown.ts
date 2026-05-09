const ZERO_WIDTH_SPACE = '​'
const PUNCTUATION_RANGES = ' -⁯⸀-⹿　-〿＀-￯'
const MARKER_PATTERN = '(?:\\*\\*|__|\\*|_)'

const leadingMarkersRegex = new RegExp(`(${MARKER_PATTERN})(?!${ZERO_WIDTH_SPACE})([${PUNCTUATION_RANGES}])`, 'g')
const trailingMarkersRegex = new RegExp(`([${PUNCTUATION_RANGES}])(?!${ZERO_WIDTH_SPACE})(${MARKER_PATTERN})`, 'g')

/**
 * 为紧挨着中英文标点的 Markdown 强调标记补齐"词边界"，避免 **"文本"** 在部分解析器中失效。
 * 通过在标记与标点之间插入零宽空格来保证渲染兼容性，同时对文本内容无视觉影响。
 */
export function normalizeMarkdownTypography(input?: string): string {
  if (!input) {
    return ''
  }

  return input
    .replace(leadingMarkersRegex, (_, markers: string, punct: string) => `${markers}${ZERO_WIDTH_SPACE}${punct}`)
    .replace(trailingMarkersRegex, (_, punct: string, markers: string) => `${punct}${ZERO_WIDTH_SPACE}${markers}`)
}
