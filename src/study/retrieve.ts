/**
 * 问书的检索：不引入向量库——对"章节总结"做 CJK 二元组 + 拉丁词的 TF·IDF 打分，标题命中加权。
 * 章节总结本身是浓缩过的，用词覆盖通常比原文更集中，这个粒度对"这本书里 X 是什么"足够；
 * 对需要原文细节的问题会如实说明依据不足（由提示词约束），而不是编造。
 */
import { matchChapterHint } from '@/charts/linking/entityIndex'

export interface RetrievableChapter {
  id: string
  title: string
  summary: string
}

export interface RetrievedChapter extends RetrievableChapter {
  score: number
}

/** 疑问/虚词二元组：几乎每章都有，既无区分度又会稀释打分 */
const STOP_BIGRAMS = new Set(['什么', '怎么', '如何', '为什', '是否', '哪些', '请问', '可以', '是不', '不是', '有没', '没有', '一个', '这本', '本书', '书中', '作者', '的是', '是什', '怎样'])

export function tokenize(s: string): string[] {
  const out: string[] = []
  const lower = (s ?? '').toLowerCase()
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) out.push(word)
  for (const run of lower.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) continue
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2)
      if (!STOP_BIGRAMS.has(bg)) out.push(bg)
    }
  }
  return out
}

/** 取最相关的 k 章（score>0）。没有任何命中返回空数组——调用方改用全书总结兜底 */
export function retrieveChapters(question: string, chapters: readonly RetrievableChapter[], k = 4): RetrievedChapter[] {
  const q = [...new Set(tokenize(question))]
  if (!q.length || !chapters.length) return []
  const docs = chapters.map((c) => ({ c, body: `${c.summary}`.toLowerCase(), title: c.title.toLowerCase() }))
  const N = docs.length
  const df = new Map<string, number>()
  for (const t of q) df.set(t, docs.filter((d) => d.body.includes(t) || d.title.includes(t)).length)

  const scored = docs.map(({ c, body, title }) => {
    let score = 0
    for (const t of q) {
      const n = df.get(t) ?? 0
      if (!n) continue
      const idf = Math.log(1 + N / n)
      let tf = 0
      for (let i = body.indexOf(t); i >= 0 && tf < 3; i = body.indexOf(t, i + t.length)) tf++
      score += idf * (tf + (title.includes(t) ? 3 : 0))
    }
    return { ...c, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k)
}

/**
 * 从回答里取出引用的章节：约定写法「【章节标题】」或「【第 N 章】」。
 * 映射不上的引用丢掉（不猜），同一章只出现一次，保持首次出现顺序。
 */
export function extractCitations(answer: string, chapters: readonly { id: string; title: string }[]): string[] {
  const ids: string[] = []
  for (const m of (answer ?? '').matchAll(/【([^】]{1,80})】/g)) {
    const id = matchChapterHint(m[1], chapters)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}
