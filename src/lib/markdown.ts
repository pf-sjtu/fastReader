/**
 * 标点范围：通用标点 / 补充标点 / CJK / 全角 / ASCII 标点
 * 与 openspec/specs/markdown-rendering 约定一致：
 * 强调标记内部首尾为标点时，在作用域**外侧**补空格。
 */
const PUNCTUATION_RE =
  /[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFFEF\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/

function isPunctuation(char: string | undefined): boolean {
  return !!char && PUNCTUATION_RE.test(char)
}

/**
 * 为指定强调标记（如 ** / * / __ / _）在「内部首尾标点」时，于作用域外侧补空格。
 * 先处理双字符标记，再处理单字符，避免 ** 被拆成两个 *。
 */
function padEmphasisOutside(input: string, marker: string): string {
  const len = marker.length
  // 单字符标记时避免匹配到 ** / __ 的一部分
  const isSingle = len === 1
  const markerChar = marker[0]

  let result = ''
  let i = 0

  while (i < input.length) {
    const isMarkerStart =
      input.startsWith(marker, i) &&
      !(isSingle && input[i + 1] === markerChar)

    if (!isMarkerStart) {
      result += input[i]
      i += 1
      continue
    }

    // 寻找成对的结束标记
    let j = i + len
    let closeAt = -1
    while (j < input.length) {
      if (input.startsWith(marker, j)) {
        if (isSingle && input[j + 1] === markerChar) {
          // 跳过 ** / __ 中的字符
          j += 2
          continue
        }
        closeAt = j
        break
      }
      j += 1
    }

    if (closeAt === -1) {
      // 无闭合，按字面输出当前字符并继续
      result += input[i]
      i += 1
      continue
    }

    const inner = input.slice(i + len, closeAt)
    let piece = marker + inner + marker

    if (inner.length > 0) {
      const starts = isPunctuation(inner[0])
      const ends = isPunctuation(inner[inner.length - 1])

      if (starts) {
        const prev = result.length > 0 ? result[result.length - 1] : ''
        if (prev !== ' ') {
          piece = ` ${piece}`
        }
      }

      if (ends) {
        const next = input[closeAt + len]
        if (next !== ' ') {
          piece = `${piece} `
        }
      }
    }

    result += piece
    i = closeAt + len
  }

  return result
}

/**
 * 为紧挨着中英文标点的 Markdown 强调标记在作用域外侧补空格，
 * 避免 **"文本"** / **文本。** 在部分解析器中渲染失败，并符合中文排版习惯。
 */
export function normalizeMarkdownTypography(input?: string): string {
  if (!input) {
    return ''
  }

  let output = input
  // 双字符优先
  for (const marker of ['**', '__', '*', '_'] as const) {
    output = padEmphasisOutside(output, marker)
  }
  return output
}
