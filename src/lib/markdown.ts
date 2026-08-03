/**
 * Markdown 渲染前预处理（薄清洗层）
 *
 * ## 架构原则（系统化方案）
 *
 * 1. **作用域/强调匹配不在本文件实现**
 *    CommonMark 用 delimiter run + left/right-flanking 规则（见
 *    https://spec.commonmark.org/ ）在 **解析器** 内匹配强调。
 *    micromark 实现该算法；CJK 场景下内侧为中文标点、外侧为汉字时，
 *    标准 CM 会失败 → 项目已用 `remark-cjk-friendly`
 *    （底层 `micromark-extension-cjk-friendly`）在解析期修正 flanking。
 *
 * 2. **本模块只做「脏源文」修复，不改写合法 Markdown**
 *    - AI 常输出 `* 文 *` / `*** 洞见 ***`（标记内侧空白 → 非法）
 *    - AI 常在段中写 `。> 引用`（`>` 须行首）
 *    - 不在这里做 ** 配对 / 外侧补空格（那是解析器职责，手写易与 ** / *** 互拆）
 *
 * 3. **管道**
 *    protect code → 段中 `>` → 去内侧空白 →（可选遗留）typography 外侧补空格
 *    默认 `prepareMarkdownForRender` **不**再跑外侧补空格，交给 remark-cjk-friendly。
 *
 * 4. **没有可靠的「通用强调正则」可替代解析器**
 *    嵌套 `***`、码段内 `*`、跨段、CJK 标点 flanking 都不是单条正则能正确覆盖的；
 *    markdownlint MD037 等只做 lint，不负责渲染。
 */

/** i 处连续 * 的数量 */
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
 * 仅当 i 处 run 长度恰好等于 marker.length 时配对。
 * 更长/更短 run 整段原样跳过（禁止 ** 被拆成 *+*）。
 */
function mapExactRunMarker(
  input: string,
  marker: string,
  mapPair: (inner: string) => string
): string {
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
      result += input.slice(i, i + openRun)
      i += openRun
      continue
    }

    let j = i + len
    let closeAt = -1
    while (j < input.length) {
      // 不跨空行配对，降低误吞下一段的风险
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
      result += input.slice(i, i + openRun)
      i += openRun
      continue
    }

    const inner = input.slice(i + len, closeAt)
    result += mapPair(inner)
    i = closeAt + len
  }
  return result
}

/**
 * 去掉成对强调内侧首尾空白：`* 文 *` → `*文*`
 * 只服务「模型脏输出」；合法无空白标记不变。
 */
export function repairLooseMarkdownEmphasis(input: string): string {
  if (!input) return ''

  const trimInner = (inner: string) => {
    const trimmed = inner.replace(/^[ \t\u00a0]+/, '').replace(/[ \t\u00a0]+$/, '')
    return trimmed.length > 0 ? trimmed : inner
  }

  let output = input
  // 长标记优先
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

/** 用于「内侧是否以标点开头/结尾」——排除 * _ */
const PUNCTUATION_RE =
  /[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFFEF\u0021-\u0029\u002B-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u007E]/

function isPunctuation(char: string | undefined): boolean {
  return !!char && PUNCTUATION_RE.test(char)
}

/**
 * 【遗留 / openspec】内侧首尾为标点时在作用域外侧补空格。
 * 渲染主路径已改用 remark-cjk-friendly 处理 CJK flanking，默认不再调用本函数。
 * 保留导出以兼容旧测试与导出管道中可能的显式需求。
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
      result += input.slice(i, i + openRun)
      i += openRun
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
      result += input.slice(i, i + openRun)
      i += openRun
      continue
    }

    const inner = input.slice(i + len, closeAt)
    let piece = marker + inner + marker

    if (inner.length > 0) {
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
 * 渲染前默认管道：只清洗明显非法源文，强调匹配交给解析器 + cjk-friendly。
 */
export function prepareMarkdownForRender(input?: string): string {
  if (!input) return ''

  return withProtectedCode(input, (body) => {
    let s = repairMidParagraphBlockquotes(body)
    s = repairLooseMarkdownEmphasis(s)
    // 不再调用 normalizeMarkdownTypography：
    // CJK 标点 flanking 由 remark-cjk-friendly 在 micromark 层处理，更系统且不易拆 **/***
    return s
  })
}
