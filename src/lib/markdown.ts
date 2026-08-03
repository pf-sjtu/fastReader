/**
 * Markdown 渲染前预处理
 *
 * ## 根因备忘（*** 字面残留）
 * 旧实现按 `**` → `*` 顺序配对，会把合法 `***洞见***` 拆成：
 *   open `**` + inner `*洞见` + close `**`，残留 `*`
 * 且 `*` 落在「标点」字符类里，inner 以 `*` 开头会被当成「内侧首标点」
 * → 在作用域**前**误加空格 → 渲染成 `。 *** 洞见***`（与线上截图一致）。
 *
 * 这是预处理作用域/配对错误，**不是**「外侧/内侧补空格规则写反」，也不是模型必然输出错误。
 * Prompt（v2）要求 `***text***` 内侧无空格；合法输出必须原样保留。
 *
 * ## 稳定处理顺序
 * protect code → 修段中 `>` → 松散内侧空白（*** 优先）→ 外侧标点空格（*** 优先，* 不算标点）
 */

/** 用于「内侧是否以标点开头/结尾」——排除 * _ 以免与 Markdown 标记混淆 */
const PUNCTUATION_RE =
  /[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFFEF\u0021-\u0029\u002B-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u007E]/

function isPunctuation(char: string | undefined): boolean {
  return !!char && PUNCTUATION_RE.test(char)
}

/** i 处连续 * 的数量是否严格大于 markerLen */
function starRunLength(input: string, i: number): number {
  let n = 0
  while (i + n < input.length && input[i + n] === '*') n++
  return n
}

function underRunLength(input: string, i: number): number {
  let n = 0
  while (i + n < input.length && input[i + n] === '_') n++
  return n
}

/**
 * 成对标记扫描：仅当 i 处 run 长度**恰好**等于 marker.length 时才视为该级标记的开/闭。
 * 这样 `***` 不会被 `**` 或 `*` 误打开。
 */
function mapExactRunMarker(
  input: string,
  marker: string,
  mapPair: (inner: string, openAt: number, closeAt: number) => string
): string {
  const len = marker.length
  const ch = marker[0]
  if (ch !== '*' && ch !== '_') {
    // 非 run 类（当前未使用）
    return input
  }
  const runLen = ch === '*' ? starRunLength : underRunLength

  let result = ''
  let i = 0
  while (i < input.length) {
    if (input[i] !== ch) {
      result += input[i]
      i += 1
      continue
    }

    const openRun = runLen(input, i)
    if (openRun !== len) {
      // 更长或更短 run：逐字吐出第一个，避免吞掉 *** 的第三颗 *
      result += input[i]
      i += 1
      continue
    }

    // 找闭合：同样要求恰好 len 个
    let j = i + len
    let closeAt = -1
    while (j < input.length) {
      if (input[j] === '\n' && input[j + 1] === '\n') break
      if (input[j] === ch) {
        const cr = runLen(input, j)
        if (cr === len) {
          closeAt = j
          break
        }
        // 更长/更短 run：跳过整段 run，避免卡在中间
        j += Math.max(1, cr)
        continue
      }
      j += 1
    }

    if (closeAt === -1) {
      result += input[i]
      i += 1
      continue
    }

    const inner = input.slice(i + len, closeAt)
    result += mapPair(inner, i, closeAt)
    i = closeAt + len
  }
  return result
}

/**
 * 去掉成对强调内侧首尾空白：`* 文 *` → `*文*`
 * 合法 `***洞见***` 不变。
 */
export function repairLooseMarkdownEmphasis(input: string): string {
  if (!input) return ''

  const trimInner = (inner: string) => {
    const trimmed = inner.replace(/^[ \t\u00a0]+/, '').replace(/[ \t\u00a0]+$/, '')
    return trimmed.length > 0 ? trimmed : inner
  }

  let output = input
  for (const marker of ['***', '**', '*', '___', '__', '_'] as const) {
    output = mapExactRunMarker(output, marker, (inner) => marker + trimInner(inner) + marker)
  }
  return output
}

/**
 * 句末后的段中 `> 引用` 提成独立行（Prompt 要求单独成行）。
 */
export function repairMidParagraphBlockquotes(input: string): string {
  if (!input) return ''
  return input.replace(/([。！？；.!?;\n])[ \t]*>[ \t]+(?=\S)/g, '$1\n\n> ')
}

function withProtectedCode(input: string, fn: (body: string) => string): string {
  const slots: string[] = []
  const stash = (full: string) => {
    const idx = slots.length
    slots.push(full)
    return `\u0000MDCODE${idx}\u0000`
  }

  let s = input
  s = s.replace(/```[\s\S]*?```/g, stash)
  s = s.replace(/`[^`\n]+`/g, stash)
  s = fn(s)
  s = s.replace(/\u0000MDCODE(\d+)\u0000/g, (_, n) => slots[Number(n)] ?? '')
  return s
}

/**
 * 内侧首/尾为标点时，在作用域**外侧**补空格。
 * 使用「恰好 N 个 *」配对；`*`/`_` 字符本身不算内侧标点。
 */
export function normalizeMarkdownTypography(input?: string): string {
  if (!input) return ''

  let output = input
  for (const marker of ['***', '**', '__', '*', '_'] as const) {
    output = padOutsideForMarker(output, marker)
  }
  return output
}

function padOutsideForMarker(input: string, marker: string): string {
  const len = marker.length
  const ch = marker[0]
  if (ch !== '*' && ch !== '_') return input
  const runLen = ch === '*' ? starRunLength : underRunLength

  let result = ''
  let i = 0
  while (i < input.length) {
    if (input[i] !== ch) {
      result += input[i]
      i += 1
      continue
    }

    const openRun = runLen(input, i)
    if (openRun !== len) {
      result += input[i]
      i += 1
      continue
    }

    let j = i + len
    let closeAt = -1
    while (j < input.length) {
      if (input[j] === '\n' && input[j + 1] === '\n') break
      if (input[j] === ch) {
        const cr = runLen(input, j)
        if (cr === len) {
          closeAt = j
          break
        }
        j += Math.max(1, cr)
        continue
      }
      j += 1
    }

    if (closeAt === -1) {
      result += input[i]
      i += 1
      continue
    }

    const inner = input.slice(i + len, closeAt)
    let piece = marker + inner + marker

    if (inner.length > 0) {
      // 与 openspec 一致：内侧首/尾标点 → 作用域外侧补空格（串首/串尾也补）
      if (isPunctuation(inner[0])) {
        const prev = result.length > 0 ? result[result.length - 1] : ''
        if (prev !== ' ' && prev !== '\n') {
          piece = ` ${piece}`
        }
      }
      if (isPunctuation(inner[inner.length - 1])) {
        const next = input[closeAt + len]
        if (next !== ' ' && next !== '\n') {
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
 * 渲染前完整管道。
 * 合法 `***text***` / `**text**` 必须保持可解析；仅修复松散空白与段中引用。
 */
export function prepareMarkdownForRender(input?: string): string {
  if (!input) return ''

  return withProtectedCode(input, (body) => {
    let s = repairMidParagraphBlockquotes(body)
    s = repairLooseMarkdownEmphasis(s)
    s = normalizeMarkdownTypography(s)
    return s
  })
}
