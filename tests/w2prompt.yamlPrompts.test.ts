/**
 * 真实 YAML 模板 × AIService 全部生成方法：渲染后不含 {{，标题与正文各恰好一次
 * 维度：prompt 类型 × v1/v2 × zh/en（mock 仅在 provider 边界）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { providerMock, warn } = vi.hoisted(() => ({
  providerMock: { generateContent: vi.fn(), testConnection: vi.fn() },
  warn: vi.fn(),
}))
vi.mock('../src/services/ai/factory', () => ({ createAIProvider: vi.fn(() => providerMock) }))
vi.mock('../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
}))

import { AIService } from '../src/services/ai/aiService'
import { loadPromptConfig } from '../src/services/prompts/config/promptLoader'

const cfg = { provider: 'openai' as const, apiKey: 'k', apiUrl: 'https://x/v1', model: 'm', temperature: 0.1 }
const TITLE = 'TITLE_MARK_甲'
const BODY = `BODY_MARK_乙${'正文'.repeat(80)}`
const BOOK = 'BOOK_MARK_丙'
const CONN = 'CONN_MARK_丁'
const OVERALL = 'OVERALL_MARK_戊'
const chapters = [
  { id: '1', title: 'CH1_MARK', content: 'c', summary: 'SUM1_MARK' },
  { id: '2', title: 'CH2_MARK', content: 'c', summary: 'SUM2_MARK' },
]

const count = (s: string, sub: string) => s.split(sub).length - 1
function lastRequest(): { prompt: string; systemPrompt: string } {
  const calls = providerMock.generateContent.mock.calls
  return calls[calls.length - 1][0]
}

type Case = {
  name: string
  run: (s: AIService, lang: 'zh' | 'en') => Promise<unknown>
  once: string[]
}
const cases: Case[] = [
  { name: 'chapterSummary.fiction', run: (s, l) => s.summarizeChapter(TITLE, BODY, 'fiction', l), once: [TITLE, BODY] },
  { name: 'chapterSummary.nonFiction', run: (s, l) => s.summarizeChapter(TITLE, BODY, 'non-fiction', l), once: [TITLE, BODY] },
  { name: 'connectionAnalysis', run: (s, l) => s.analyzeConnections(chapters, l), once: ['CH1_MARK', 'SUM1_MARK', 'SUM2_MARK'] },
  { name: 'overallSummary', run: (s, l) => s.generateOverallSummary(BOOK, chapters, CONN, l), once: [BOOK, 'SUM1_MARK', 'SUM2_MARK', CONN] },
  { name: 'keyCharts', run: (s, l) => s.generateKeyCharts(BOOK, chapters, CONN, OVERALL, l).catch(() => null), once: [BOOK, 'SUM1_MARK', CONN, OVERALL] },
  { name: 'mindmap.chapter', run: (s, l) => s.generateChapterMindMap(TITLE, BODY, l), once: [TITLE, BODY] },
  { name: 'mindmap.arrow', run: (s, l) => s.generateMindMapArrows(chapters, l), once: ['CH1_MARK', 'SUM1_MARK', 'SUM2_MARK'] },
  { name: 'mindmap.combined', run: (s, l) => s.generateCombinedMindMap(BOOK, chapters, l), once: [BOOK, 'SUM1_MARK', 'SUM2_MARK'] },
]

describe.each(['v1', 'v2'] as const)('真实 YAML %s', (version) => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.generateContent.mockResolvedValue({ content: '{}' })
  })

  describe.each(['zh', 'en'] as const)('%s', (lang) => {
    it.each(cases)('$name：无残留占位符，标题/正文各一次', async ({ run, once }) => {
      const service = new AIService(cfg, () => loadPromptConfig(version))
      await run(service, lang)
      const { prompt, systemPrompt } = lastRequest()
      expect(prompt).not.toContain('{{')
      for (const mark of once) expect(count(prompt, mark)).toBe(1)
      expect(systemPrompt).toBe(lang === 'zh' ? '请用中文回复。' : 'Please respond in English.')
      expect(warn).not.toHaveBeenCalled()
    })
  })

  it('YAML 模板实际引用的占位符与代码传入的变量名一一对应', () => {
    const c = loadPromptConfig(version)
    const names = (t: string) => [...new Set([...t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))].sort()
    expect(names(c.chapterSummary.fiction)).toEqual(['content', 'title'])
    expect(names(c.chapterSummary.nonFiction)).toEqual(['content', 'title'])
    expect(names(c.connectionAnalysis)).toEqual(['chapterSummaries'])
    expect(names(c.overallSummary)).toEqual(['bookTitle', 'chapterInfo', 'connections'])
    expect(names(c.mindmap.chapter)).toEqual([])
    expect(names(c.mindmap.arrow)).toEqual([])
    expect(names(c.mindmap.combined)).toEqual([])
  })
})

describe('占位符替换后的结构', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.generateContent.mockResolvedValue({ content: 'ok' })
  })

  it('v1 章节总结：正文落在模板占位处，指令在正文之后，不再追加「章节内容:」段', async () => {
    await new AIService(cfg, () => loadPromptConfig('v1')).summarizeChapter(TITLE, BODY, 'non-fiction', 'zh')
    const { prompt } = lastRequest()
    expect(prompt).toContain(`章节标题：${TITLE}`)
    expect(prompt).not.toContain('章节内容:\n')
    expect(prompt.indexOf(BODY)).toBeLessThan(prompt.indexOf('关键概念'))
  })

  it('v1 全书总结：书名进《》，不再追加「书名:」段', async () => {
    await new AIService(cfg, () => loadPromptConfig('v1')).generateOverallSummary(BOOK, chapters, CONN, 'zh')
    const { prompt } = lastRequest()
    expect(prompt).toContain(`《${BOOK}》`)
    expect(prompt).not.toContain('书名:')
  })

  it('自定义 prompt 不含占位符时回退追加（行为与旧版一致）', async () => {
    await new AIService(cfg).summarizeChapter('标题', BODY, 'fiction', 'zh', '自定义')
    expect(lastRequest().prompt).toBe(`自定义\n\n章节标题: 标题\n\n章节内容:\n${BODY}`)
  })

  it('自定义 prompt 含未知占位符：保留并告警，正文仍只发一次', async () => {
    await new AIService(cfg).summarizeChapter('标题', BODY, 'fiction', 'zh', '{{foo}} {{content}}')
    const { prompt } = lastRequest()
    expect(prompt.startsWith('{{foo}} ')).toBe(true)
    expect(count(prompt, BODY)).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
