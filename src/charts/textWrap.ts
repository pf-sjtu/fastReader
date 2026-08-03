/**
 * 纯函数文字换行（图表布局用，不依赖 DOM）
 * 中文按字拆，英文尽量按词
 */

export function wrapText(
  text: string,
  maxWidth: number,
  /** 估算：中文 ~1em，半角 ~0.55em */
  measureChar: (ch: string) => number = defaultMeasure
): string[] {
  const raw = (text || '').trim()
  if (!raw) return ['']
  if (maxWidth <= 0) return [raw]

  const lines: string[] = []
  let line = ''
  let lineW = 0

  const flush = () => {
    if (line) {
      lines.push(line)
      line = ''
      lineW = 0
    }
  }

  // 先按空白分词，再对超长 token 按字拆
  const tokens = raw.split(/(\s+)/)
  for (const token of tokens) {
    if (!token) continue
    const tw = measureString(token, measureChar)
    if (lineW + tw <= maxWidth) {
      line += token
      lineW += tw
      continue
    }
    // token 本身超宽：按字硬拆
    if (tw > maxWidth) {
      flush()
      for (const ch of token) {
        const cw = measureChar(ch)
        if (lineW + cw > maxWidth && line) flush()
        line += ch
        lineW += cw
      }
      continue
    }
    flush()
    line = token
    lineW = tw
  }
  flush()
  return lines.length ? lines : ['']
}

function measureString(s: string, measureChar: (ch: string) => number): number {
  let w = 0
  for (const ch of s) w += measureChar(ch)
  return w
}

function defaultMeasure(ch: string): number {
  // 以「字宽单位」计：中日韩全角 1，其它 0.55
  if (/[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(ch)) return 1
  if (ch === ' ') return 0.35
  return 0.55
}

/** 在给定字号（px）与容器宽（px）下估算可排字符单位宽度 */
export function maxUnitsForWidth(widthPx: number, fontSizePx: number): number {
  // 全角约等于 fontSize 宽
  return Math.max(2, widthPx / fontSizePx)
}
