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

const LANG = RICH_LANGS.join('|')
// 注意：这里用普通字符串拼正则（反引号在单引号字符串里不需要转义），\\ 是正则里的反斜杠
const OPEN = '^[ \\t]{0,3}(`{3,}|~{3,})[ \\t]*(?:' + LANG + ')\\b[^\\n]*'
/** 已闭合的富内容块：开栏行 + 内容 + 同种同长（或更长）的闭栏行 */
const CLOSED = new RegExp(OPEN + '\\n[\\s\\S]*?\\n[ \\t]{0,3}\\1[ \\t]*$', 'gim')
/** 开栏之后一直没闭合（被截断）：到文末 */
const UNCLOSED = new RegExp(OPEN + '(?:\\n[\\s\\S]*)?$', 'im')
/** 任意围栏代码块（含普通代码）：只该处理正文的逻辑（加粗上限、标题 / 分割线清理）要避开它们 */
const ANY_FENCE = new RegExp('(^[ \\t]{0,3}(`{3,}|~{3,})[^\\n]*\\n[\\s\\S]*?\\n[ \\t]{0,3}\\2[ \\t]*$)', 'gm')

/** 去掉所有富内容块（含未闭合的尾部），留下纯文字部分 */
export function stripRichBlocks(md: string): string {
  if (!md) return ''
  return md.replace(CLOSED, '').replace(UNCLOSED, '').replace(/\n{3,}/g, '\n\n')
}

/** 「字数」：富内容块不计入，首尾空白不计 */
export const proseLength = (md: string): number => stripRichBlocks(md).trim().length

/** 文中有几个富内容块（已闭合的 + 未闭合的尾部） */
export function richBlockCount(md: string): number {
  if (!md) return 0
  const closed = (md.match(CLOSED) ?? []).length
  return closed + (UNCLOSED.test(md.replace(CLOSED, '')) ? 1 : 0)
}

/**
 * 把文本按「围栏代码块 / 其余」切开，偶数下标是正文、奇数下标是围栏块；拼回去等于原文。
 * 加粗上限、标题 / 分割线清理等只该作用于正文，不能误伤代码块、图表源码、HTML 小部件里的 `**` `#` `---`。
 */
export function splitByFences(md: string): string[] {
  // split 带两个捕获组：每个围栏会插入 [整块, 围栏符] 两项，保留整块、丢掉围栏符
  return md.split(ANY_FENCE).filter((_, i) => i % 3 !== 2)
}

export const isRichLang = (lang: string | undefined): lang is RichLang => !!lang && (RICH_LANGS as readonly string[]).includes(lang.toLowerCase())
