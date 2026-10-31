import { describe, it, expect } from 'vitest'
import { AIService } from '../../src/services/ai/aiService'
import type { AIProviderConfig } from '../../src/stores/types'

const cfg = { id: 1, name: 't', provider: 'openai', apiKey: 'k', apiUrl: 'https://x.example/v1', model: 'm', customFields: {} } as unknown as AIProviderConfig

type Gen = (prompt: string, lang?: string, opts?: { signal?: AbortSignal }) => Promise<string>
function svc(gen: Gen) {
  const s = new AIService(cfg)
  ;(s as unknown as { generateContent: Gen }).generateContent = gen
  return s
}

const mkChapters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, title: `第${i + 1}章 标题${i + 1}`, content: '', summary: `第${i + 1}章的总结内容`, processed: true }))

const kitFor = (titles: string[]) =>
  JSON.stringify({ version: 1, chapters: titles.map((t) => ({ chapterTitle: t, oneLiner: `${t}一句话`, points: ['a', 'b', 'c'] })) })

describe('generateStudyKit', () => {
  it('章节按 30 一批请求并合并；onBatch 进度回调', async () => {
    const prompts: string[] = []
    const s = svc(async (prompt) => {
      prompts.push(prompt)
      const titles = [...prompt.matchAll(/"title":"([^"]+)"/g)].map((m) => m[1])
      return kitFor(titles)
    })
    const progress: number[][] = []
    const kit = await s.generateStudyKit('书', mkChapters(65), 'zh', { onBatch: (d, t) => progress.push([d, t]) })
    expect(prompts).toHaveLength(3) // 30 + 30 + 5
    expect(kit.chapters).toHaveLength(65)
    expect(kit.chapters[64].chapterId).toBe('c65')
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('某一批失败只丢这一批；全部失败才抛错', async () => {
    let call = 0
    const partial = svc(async (prompt) => {
      if (++call === 2) throw new Error('网络错误')
      const titles = [...prompt.matchAll(/"title":"([^"]+)"/g)].map((m) => m[1])
      return kitFor(titles)
    })
    const kit = await partial.generateStudyKit('书', mkChapters(40), 'zh')
    expect(kit.chapters).toHaveLength(30) // 第 2 批（10 章）丢失

    const bad = svc(async () => '抱歉我做不到')
    await expect(bad.generateStudyKit('书', mkChapters(3), 'zh')).rejects.toThrow('解析失败')
    const down = svc(async () => {
      throw new Error('HTTP 500')
    })
    await expect(down.generateStudyKit('书', mkChapters(3), 'zh')).rejects.toThrow('HTTP 500')
  })

  it('取消信号立即向上抛出，不被当作"这批失败"吞掉', async () => {
    const ac = new AbortController()
    const s = svc(async () => {
      ac.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(s.generateStudyKit('书', mkChapters(40), 'zh', { signal: ac.signal })).rejects.toThrow('aborted')
  })

  it('没有可用章节总结时明确报错，不发请求', async () => {
    let called = false
    const s = svc(async () => ((called = true), ''))
    await expect(s.generateStudyKit('书', [{ id: 'c1', title: 't', content: '', processed: false } as never], 'zh')).rejects.toThrow('没有可用')
    expect(called).toBe(false)
  })
})

describe('generateQuiz', () => {
  it('提示词带上题数与章节材料；解析后章节映射回 id', async () => {
    let seen = ''
    const s = svc(async (prompt) => {
      seen = prompt
      return JSON.stringify({ questions: [{ type: 'short', question: '问', answer: '答', chapterTitle: '第2章 标题2' }] })
    })
    const quiz = await s.generateQuiz('书', mkChapters(3), 12, 'zh')
    expect(seen).toContain('共出 12 道题')
    expect(seen).toContain('第3章的总结内容')
    expect(quiz.questions[0].chapterId).toBe('c2')
  })

  it('无有效题 → 抛错', async () => {
    await expect(svc(async () => '{"questions":[]}').generateQuiz('书', mkChapters(2), 5, 'zh')).rejects.toThrow('自测题')
  })
})

describe('askBook', () => {
  it('把全书总结、检索章节、对话历史、问题都放进提示词；返回去空白后的回答', async () => {
    let seen = ''
    const s = svc(async (prompt) => ((seen = prompt), '  答案【第1章】  '))
    const ans = await s.askBook('书名', '全书总结文本', '【第1章 标题1】相关内容', 'Q: 前一问\nA: 前一答', '这一问？', 'zh')
    expect(ans).toBe('答案【第1章】')
    for (const part of ['书名', '全书总结文本', '【第1章 标题1】相关内容', 'Q: 前一问', '这一问？']) expect(seen).toContain(part)
  })

  it('没有检索到章节时提示词明确写出"没有检索到相关章节"，而不是留空', async () => {
    let seen = ''
    const s = svc(async (prompt) => ((seen = prompt), 'x'))
    await s.askBook('书', '总结', '', '', '问', 'zh')
    expect(seen).toContain('没有检索到相关章节')
  })
})
