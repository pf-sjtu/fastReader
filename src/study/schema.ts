/**
 * 学习功能的数据结构与解析：速读层（StudyKit）、自测（Quiz）。
 * 原则同关键图表：模型输出不可信——先抽 JSON，再 zod 校验；坏的单项丢弃，不让一道坏题毁掉整份结果。
 */
import { z } from 'zod'
import { extractJsonObject } from '@/charts/parseCharts'
import { matchChapterHint } from '@/charts/linking/entityIndex'

export const STUDY_LIMITS = { points: 5, terms: 5, questions: 30 } as const

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max))

/* ---------------- 速读层 ---------------- */

const rawKitChapter = z.object({
  chapterTitle: text(200),
  oneLiner: text(200),
  points: z.array(z.string().trim().min(1).max(300)).min(1),
  terms: z.array(z.object({ term: text(60), definition: text(200) })).optional(),
})

export interface StudyChapter {
  /** 映射到真实章节；模型给的标题对不上时为 null（界面不展示该条，不猜） */
  chapterId: string | null
  chapterTitle: string
  oneLiner: string
  points: string[]
  terms: { term: string; definition: string }[]
}

export interface StudyKit {
  version: 1
  chapters: StudyChapter[]
}

export function parseStudyKit(raw: string, chapters: readonly { id: string; title: string }[]): StudyKit | null {
  const json = extractJsonObject(raw)
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const list = (data as { chapters?: unknown })?.chapters
  if (!Array.isArray(list)) return null
  const out: StudyChapter[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const r = rawKitChapter.safeParse(item)
    if (!r.success) continue
    const chapterId = matchChapterHint(r.data.chapterTitle, chapters)
    // 同一章只留第一条（模型偶尔重复）
    if (chapterId) {
      if (seen.has(chapterId)) continue
      seen.add(chapterId)
    }
    out.push({
      chapterId,
      chapterTitle: r.data.chapterTitle,
      oneLiner: r.data.oneLiner,
      points: r.data.points.slice(0, STUDY_LIMITS.points),
      terms: (r.data.terms ?? []).slice(0, STUDY_LIMITS.terms),
    })
  }
  return out.length ? { version: 1, chapters: out } : null
}

/* ---------------- 自测 ---------------- */

const rawQuestion = z.object({
  type: z.enum(['choice', 'short']),
  question: text(400),
  options: z.array(z.string().trim().min(1).max(200)).optional(),
  answerIndex: z.number().int().optional(),
  answer: z.string().trim().max(600).optional(),
  explanation: z.string().trim().max(600).optional(),
  chapterTitle: z.string().trim().max(200).optional(),
})

export interface QuizQuestion {
  id: string
  type: 'choice' | 'short'
  question: string
  options?: string[]
  /** 选择题：正确选项下标 */
  answerIndex?: number
  /** 简答题：参考答案 */
  answer?: string
  explanation: string
  chapterId: string | null
  chapterTitle: string
}

export interface Quiz {
  version: 1
  questions: QuizQuestion[]
}

/** 选择题要有 2–6 个选项且答案下标在范围内；简答题要有参考答案。不满足就丢这一题 */
export function parseQuiz(raw: string, chapters: readonly { id: string; title: string }[]): Quiz | null {
  const json = extractJsonObject(raw)
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const list = (data as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return null
  const questions: QuizQuestion[] = []
  for (const item of list) {
    if (questions.length >= STUDY_LIMITS.questions) break
    const r = rawQuestion.safeParse(item)
    if (!r.success) continue
    const q = r.data
    if (q.type === 'choice') {
      const n = q.options?.length ?? 0
      if (n < 2 || n > 6 || q.answerIndex === undefined || q.answerIndex < 0 || q.answerIndex >= n) continue
    } else if (!q.answer) continue
    const chapterTitle = q.chapterTitle ?? ''
    questions.push({
      id: `q${questions.length + 1}`,
      type: q.type,
      question: q.question,
      options: q.type === 'choice' ? q.options : undefined,
      answerIndex: q.type === 'choice' ? q.answerIndex : undefined,
      answer: q.answer,
      explanation: q.explanation ?? '',
      chapterId: matchChapterHint(chapterTitle, chapters),
      chapterTitle,
    })
  }
  return questions.length ? { version: 1, questions } : null
}
