/**
 * 总结里的「富内容块」：用围栏代码块写的 mermaid 图 / genui 交互组件 / html 小部件。
 * 目的是帮读者把复杂、抽象的内容具象化，不是必备品；它们 **不计入字数**——
 * 质量闸、压缩阈值、加粗上限、下游 prompt 的输入长度，一律先剔除这些块，只看文字。
 *
 * 纯函数。围栏规则：3 个以上的反引号或波浪线开栏，同种且不更短的围栏闭栏；
 * 没有闭合的围栏（输出被截断）按「到文末都是块」处理，同样不计字数，渲染时回退为源码。
 */

export const RICH_LANGS = ['mermaid', 'genui', 'html'] as const
export type RichLang = (typeof RICH_LANGS)[number]

interface Fence { start: number; end: number; code: string; lang: string; closed: boolean }

/** 按行扫描所有围栏，避免把普通代码示例里的富块当成真正的块。 */
function scanFences(md: string): Fence[] {
  const lines = [...md.matchAll(/[^\n]*(?:\n|$)/g)].filter((m) => m[0].length > 0)
  const out: Fence[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[^\r\n]*\r?\n?$/.exec(lines[i][0])
    if (!open) continue
    const start = lines[i].index!, contentStart = start + lines[i][0].length
    let end = md.length, codeEnd = md.length, closed = false
    for (let j = i + 1; j < lines.length; j++) {
      const close = /^[ \t]{0,3}(`+|~+)[ \t]*\r?(?:\n|$)$/.exec(lines[j][0])
      if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) {
        codeEnd = lines[j].index!; end = codeEnd + lines[j][0].replace(/\r?\n$/, '').length
        closed = true; i = j; break
      }
    }
    out.push({ start, end, code: md.slice(contentStart, codeEnd).replace(/\r?\n$/, ''), lang: open[2].toLowerCase(), closed })
    if (!closed) break
  }
  return out
}

export interface RichBlockInfo {
  lang: RichLang
  /** 围栏内的源码（不含围栏行） */
  code: string
  /** 没有闭栏：输出被截断 */
  truncated: boolean
  /** 原文（含围栏）：不需要改动的块原样写回 */
  raw: string
}

/**
 * 逐个富内容块替换：fn 返回新的整块文本（含围栏），返回空串 = 删除该块。正文原样保留。
 * 修复坏块时用：只动块、不碰正文。
 */
export function mapRichBlocks(md: string, fn: (b: RichBlockInfo, index: number) => string): string {
  if (!md) return ''
  let out = '', pos = 0, i = 0
  for (const f of scanFences(md)) {
    if (!isRichLang(f.lang)) continue
    const raw = md.slice(f.start, f.end)
    out += md.slice(pos, f.start) + fn({ lang: f.lang, code: f.code, truncated: !f.closed, raw }, i++)
    pos = f.end
  }
  return out + md.slice(pos)
}

export function listRichBlocks(md: string): RichBlockInfo[] {
  const out: RichBlockInfo[] = []
  mapRichBlocks(md, (b) => (out.push(b), ''))
  return out
}

/** 按围栏长度安全地写回一个块：源码里出现 ``` 时用更长的围栏 */
export function fenceRichBlock(lang: string, code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((s) => s.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang}\n${code.replace(/\n+$/, '')}\n${fence}`
}

/** 去掉所有富内容块（含未闭合的尾部），留下纯文字部分 */
export function stripRichBlocks(md: string): string {
  if (!md) return ''
  return mapRichBlocks(md, () => '').replace(/\n{3,}/g, '\n\n')
}

/** 「字数」：富内容块不计入，首尾空白不计 */
export const proseLength = (md: string): number => stripRichBlocks(md).trim().length

/** 文中有几个富内容块（已闭合的 + 未闭合的尾部） */
export function richBlockCount(md: string): number {
  if (!md) return 0
  return listRichBlocks(md).length
}

/**
 * 把文本按「围栏代码块 / 其余」切开，偶数下标是正文、奇数下标是围栏块；拼回去等于原文。
 * 加粗上限、标题 / 分割线清理等只该作用于正文，不能误伤代码块、图表源码、HTML 小部件里的 `**` `#` `---`。
 */
export function splitByFences(md: string): string[] {
  const parts: string[] = []
  let pos = 0
  for (const f of scanFences(md)) {
    if (!f.closed) break
    parts.push(md.slice(pos, f.start), md.slice(f.start, f.end)); pos = f.end
  }
  parts.push(md.slice(pos))
  return parts
}

export const isRichLang = (lang: string | undefined): lang is RichLang => !!lang && (RICH_LANGS as readonly string[]).includes(lang.toLowerCase())
