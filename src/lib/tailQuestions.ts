/**
 * 章末「启发性问题」的识别与统一：提示词要求每题独占一行，但模型常见三种写法——
 *   ① 每题一段（空行隔开） ② 每题一行但不空行（Markdown 会并成一段） ③ 同一行连写多个问句。
 * 这里统一成 ①：每题一段。生成时（sanitizeSummary，前后端 / CLI 同语义）与渲染时（remarkTailQuestions，兼容旧缓存）共用。
 *
 * 保守原则：只认文末连续的「整行都是问句」，且至少 2 题；正文里的设问不受影响。
 */

/** 行首的列表符号 / 序号 / Q1：—— 统一剥掉 */
const MARK_RE = /^\s*(?:[-*+]|\d{1,2}[.、)）]|[（(]\d{1,2}[)）]|Q\d{1,2}\s*[:：.])\s*/i
const END_RE = /[？?]$/
const SENTENCE_RE = /[^？?]+[？?]+/g

export const QUESTION_MAX = 90
/** 同一行连写多个问句时，每句更严（避免把一段长论述按问号切碎） */
const MULTI_MAX = 60

/** 一行文字 → 问句列表；必须整行都是问句，否则 null */
export function questionsOfLine(line: string): string[] | null {
  const t = line.replace(MARK_RE, '').trim()
  if (!t || !END_RE.test(t)) return null
  const sentences = (t.match(SENTENCE_RE) ?? []).map((s) => s.replace(MARK_RE, '').trim()).filter(Boolean)
  if (!sentences.length) return null
  const max = sentences.length > 1 ? MULTI_MAX : QUESTION_MAX
  return sentences.every((s) => s.length <= max) ? sentences : null
}

/** 取出文末连续的问句；不足 2 题返回 null */
export function extractTailQuestions(prose: string): { head: string; questions: string[] } | null {
  const lines = prose.replace(/\s+$/, '').split('\n')
  const questions: string[] = []
  let i = lines.length
  while (i > 0) {
    if (!lines[i - 1].trim()) {
      i--
      continue
    }
    const qs = questionsOfLine(lines[i - 1])
    if (!qs) break
    questions.unshift(...qs)
    i--
  }
  if (questions.length < 2) return null
  return { head: lines.slice(0, i).join('\n').replace(/\s+$/, ''), questions }
}

/** 统一成「每题一段」；没有文末问题时原样返回（幂等） */
export function normalizeTailQuestions(prose: string): string {
  const r = extractTailQuestions(prose)
  if (!r) return prose
  return `${r.head}${r.head ? '\n\n' : ''}${r.questions.join('\n\n')}`
}
