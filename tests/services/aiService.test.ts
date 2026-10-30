import { describe, it, expect, vi, beforeEach } from 'vitest'

const { providerMock } = vi.hoisted(() => ({
  providerMock: {
    generateContent: vi.fn(),
    testConnection: vi.fn(),
  },
}))

vi.mock('../../src/services/ai/factory', () => ({
  createAIProvider: vi.fn(() => providerMock),
}))

vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { AIService, SKIPPED_SUMMARY_PREFIX } from '../../src/services/ai'
import { RESULT_PREFIX } from '../../src/utils/resultStatus'

const mockConfig = {
  provider: 'openai' as const,
  apiKey: 'test-api-key',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-3.5-turbo',
  temperature: 0.7
}

const longText = '内容'.repeat(100)

const chapters = [
  { id: '1', title: '一', content: 'c', summary: '第一章摘要' },
  { id: '2', title: '二', content: 'c', summary: `${RESULT_PREFIX.chapterFailed}网络错误` },
  { id: '3', title: '三', content: 'c', summary: AIService.createSkippedSummary('短') },
  { id: '4', title: '四', content: 'c', summary: '   ' },
  { id: '5', title: '五', content: 'c', summary: '第五章摘要' },
]

function lastPrompt(): string {
  const calls = providerMock.generateContent.mock.calls
  return calls[calls.length - 1][0].prompt
}

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.generateContent.mockResolvedValue({ content: 'AI结果' })
  })

  it('should initialize with config', () => {
    expect(new AIService(mockConfig)).toBeDefined()
  })

  it('SKIPPED_SUMMARY_PREFIX 与 RESULT_PREFIX.chapterSkipped 一致', () => {
    expect(SKIPPED_SUMMARY_PREFIX).toBe(RESULT_PREFIX.chapterSkipped)
  })

  it('createSkippedSummary / isSkippedSummary', () => {
    const summary = AIService.createSkippedSummary('内容太短')
    expect(summary).toContain(SKIPPED_SUMMARY_PREFIX)
    expect(summary).toContain('内容太短')
    expect(AIService.createSkippedSummary()).toContain(SKIPPED_SUMMARY_PREFIX)
    expect(AIService.isSkippedSummary(`${SKIPPED_SUMMARY_PREFIX} 触发内容过滤`)).toBe(true)
    expect(AIService.isSkippedSummary('普通摘要')).toBe(false)
  })

  it('summarizeChapter 内容过短直接跳过，不调用 AI', async () => {
    const summary = await new AIService(mockConfig).summarizeChapter('短章节', '太短', 'non-fiction', 'zh')
    expect(summary).toContain(SKIPPED_SUMMARY_PREFIX)
    expect(providerMock.generateContent).not.toHaveBeenCalled()
  })

  it('summarizeChapter 把 opts（signal）透传给 provider，并带语言指令', async () => {
    const ctrl = new AbortController()
    const opts = { signal: ctrl.signal }
    const result = await new AIService(mockConfig).summarizeChapter('标题', longText, 'fiction', 'zh', '自定义', opts)
    expect(result).toBe('AI结果')
    const [request, passedOpts] = providerMock.generateContent.mock.calls[0]
    expect(passedOpts).toBe(opts)
    expect(request.systemPrompt).toBe('请用中文回复。')
    expect(request.prompt.startsWith('自定义')).toBe(true)
    expect(request.prompt).toContain('章节标题: 标题')
  })

  it('未配置 prompt 时使用 YAML 默认模板（非空、无 undefined）', async () => {
    await new AIService(mockConfig).summarizeChapter('标题', longText, 'non-fiction', 'zh')
    const prompt = lastPrompt()
    expect(prompt.length).toBeGreaterThan(longText.length + 50)
    expect(prompt).not.toContain('undefined')
  })

  it('analyzeConnections 只喂可用章节，JSON 无缩进', async () => {
    const service = new AIService(mockConfig)
    await service.analyzeConnections(chapters, 'zh')
    const prompt = lastPrompt()
    expect(prompt).toContain('第一章摘要')
    expect(prompt).toContain('第五章摘要')
    expect(prompt).not.toContain(RESULT_PREFIX.chapterFailed)
    expect(prompt).not.toContain(RESULT_PREFIX.chapterSkipped)
    expect(prompt).toContain('[{"index":1,"title":"一","summary":"第一章摘要"},{"index":2,"title":"五"')
  })

  it('analyzeConnections 可用章节不足 2 个时不调用 AI', async () => {
    const r = await new AIService(mockConfig).analyzeConnections(chapters.slice(0, 4))
    expect(r).toContain('章节数量不足')
    expect(providerMock.generateContent).not.toHaveBeenCalled()
  })

  it('generateOverallSummary 只喂可用章节；无可用章节时直接返回提示', async () => {
    const service = new AIService(mockConfig)
    const ctrl = new AbortController()
    await service.generateOverallSummary('书', chapters, '关联文本', 'zh', { signal: ctrl.signal })
    const prompt = lastPrompt()
    // 默认 v1 模板含 {{bookTitle}}：书名替换进《》，不再追加「书名:」段
    expect(prompt).toContain('《书》')
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('关联文本')
    expect(prompt).not.toContain(RESULT_PREFIX.chapterFailed)
    expect(providerMock.generateContent.mock.calls[0][1].signal).toBe(ctrl.signal)

    const none = await service.generateOverallSummary('书', chapters.slice(1, 4), '')
    expect(none).toContain('没有可用的章节摘要')
  })

  it('generateKeyCharts 无可用章节抛错；解析失败抛错', async () => {
    const service = new AIService(mockConfig)
    await expect(service.generateKeyCharts('书', chapters.slice(1, 3), '', '')).rejects.toThrow('没有可用的章节摘要')
    providerMock.generateContent.mockResolvedValue({ content: 'not json' })
    await expect(service.generateKeyCharts('书', chapters, 'c', 'o')).rejects.toThrow('解析失败')
    expect(lastPrompt()).not.toContain(RESULT_PREFIX.chapterFailed)
  })

  it('generateChapterMindMap / generateCombinedMindMap 解析 JSON', async () => {
    const service = new AIService(mockConfig)
    providerMock.generateContent.mockResolvedValue({ content: '前缀 {"nodeData":{"id":"r","topic":"T"}} 后缀' })
    await expect(service.generateChapterMindMap('t', 'c')).resolves.toEqual({ nodeData: { id: 'r', topic: 'T' } })
    await expect(service.generateCombinedMindMap('书', chapters)).resolves.toEqual({ nodeData: { id: 'r', topic: 'T' } })
    expect(lastPrompt()).not.toContain(RESULT_PREFIX.chapterFailed)

    providerMock.generateContent.mockResolvedValue({ content: '{bad json}' })
    await expect(service.generateChapterMindMap('t', 'c')).resolves.toBeNull()
    await expect(service.generateCombinedMindMap('书', chapters.slice(1, 4))).resolves.toBeNull()
  })

  it('generateMindMapArrows 只喂可用章节并解析数组', async () => {
    providerMock.generateContent.mockResolvedValue({ content: '[{"from":"1","to":"5","label":"x"}]' })
    const arrows = await new AIService(mockConfig).generateMindMapArrows(chapters)
    expect(arrows).toEqual([{ from: '1', to: '5', label: 'x' }])
    const prompt = lastPrompt()
    expect(prompt).not.toContain(RESULT_PREFIX.chapterSkipped)
    expect(prompt).toContain('"id":"5"')

    providerMock.generateContent.mockResolvedValue({ content: 'nope' })
    await expect(new AIService(mockConfig).generateMindMapArrows(chapters)).resolves.toEqual([])
  })

  it('输出被截断时调用 onTruncated', async () => {
    providerMock.generateContent.mockResolvedValue({ content: '半截', truncated: true, finishReason: 'length' })
    const onTruncated = vi.fn()
    const r = await new AIService(mockConfig).summarizeChapter('t', longText, 'fiction', 'en', undefined, { onTruncated })
    expect(r).toBe('半截')
    expect(onTruncated).toHaveBeenCalledWith({ finishReason: 'length' })
  })

  it('无 signal 的相同请求复用进行中的 promise；带 signal 的不复用', async () => {
    let resolve!: (v: { content: string }) => void
    providerMock.generateContent.mockImplementation(() => new Promise((r) => (resolve = r)))
    const service = new AIService(() => mockConfig)
    const a = service.generateChapterMindMap('t', 'c')
    const b = service.generateChapterMindMap('t', 'c')
    expect(providerMock.generateContent).toHaveBeenCalledTimes(1)
    resolve({ content: 'null' })
    await Promise.all([a, b])

    providerMock.generateContent.mockResolvedValue({ content: 'x' })
    const signal = new AbortController().signal
    await Promise.all([
      service.generateChapterMindMap('t', 'c', 'en', { signal }),
      service.generateChapterMindMap('t', 'c', 'en', { signal }),
    ])
    expect(providerMock.generateContent).toHaveBeenCalledTimes(3)
  })

  it('testConnection 成功时额外生成一次；异常时返回失败', async () => {
    providerMock.testConnection.mockResolvedValue({ success: true })
    await expect(new AIService(mockConfig).testConnection()).resolves.toEqual({ success: true })
    expect(providerMock.generateContent).toHaveBeenCalledTimes(1)

    providerMock.testConnection.mockRejectedValue(new Error('boom'))
    await expect(new AIService(mockConfig).testConnection()).resolves.toEqual({ success: false, error: 'boom' })
  })
})

describe('超长章节按模型输入预算自动分段总结', () => {
  beforeEach(() => providerMock.generateContent.mockReset())

  // 小上下文模型：输入预算 = 8192 − min(2048, 8192/4) − 2048 = 4096 字
  const small = { ...mockConfig, contextWindow: 8192, maxOutputTokens: 2048 }
  const prompt = '总结：{{title}}\n{{content}}'
  const para = (i: number) => `第${i}段。` + '字'.repeat(900)
  const longChapter = Array.from({ length: 10 }, (_, i) => para(i)).join('\n\n') // ~9K 字

  it('未超预算：单次调用（行为不变）', async () => {
    providerMock.generateContent.mockResolvedValue({ content: '整章总结' })
    const svc = new AIService({ ...mockConfig, contextWindow: 1_000_000, maxOutputTokens: 8192 }, () => ({
      chapterSummary: { fiction: prompt, nonFiction: prompt },
      mindmap: { chapter: '', arrow: '', combined: '' },
      connectionAnalysis: '',
      overallSummary: '',
    }))
    expect(await svc.summarizeChapter('长章', longChapter, 'non-fiction', 'zh')).toBe('整章总结')
    expect(providerMock.generateContent).toHaveBeenCalledTimes(1)
  })

  it('超预算：分段 → 每段同一提示词总结 → 合并；每次请求都不超预算，正文不丢', async () => {
    let n = 0
    providerMock.generateContent.mockImplementation(async () => ({ content: `分段总结${++n}` }))
    const svc = new AIService(small, () => ({
      chapterSummary: { fiction: prompt, nonFiction: prompt },
      mindmap: { chapter: '', arrow: '', combined: '' },
      connectionAnalysis: '',
      overallSummary: '',
    }))
    const out = await svc.summarizeChapter('长章', longChapter, 'non-fiction', 'zh')
    const prompts = providerMock.generateContent.mock.calls.map((c) => c[0].prompt as string)

    expect(prompts.length).toBeGreaterThanOrEqual(4) // ≥3 段 + 1 次合并
    for (const p of prompts) expect(p.length).toBeLessThanOrEqual(4096 + prompt.length)
    // 所有段落都出现在某个分段请求里（不截断丢内容）
    for (let i = 0; i < 10; i++) expect(prompts.some((p) => p.includes(`第${i}段。`))).toBe(true)
    // 分段请求带「第 i/n 部分」，合并请求带全部分段总结
    expect(prompts[0]).toMatch(/长章（第 1\/\d+ 部分）/)
    const last = prompts[prompts.length - 1]
    expect(last).toContain('分段总结合并')
    expect(last).toContain('【第 1/')
    expect(out).toBe(`分段总结${n}`)
  })

  it('无上下文元数据：不切分（保持旧行为）', async () => {
    providerMock.generateContent.mockResolvedValue({ content: 'x' })
    const svc = new AIService(mockConfig)
    await svc.summarizeChapter('长章', longChapter, 'non-fiction', 'zh')
    expect(providerMock.generateContent).toHaveBeenCalledTimes(1)
  })

  it('后处理阈值随模型上下文缩小：小窗口模型的关联分析输入被压缩', async () => {
    providerMock.generateContent.mockResolvedValue({ content: '关联' })
    const svc = new AIService(small)
    const big = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, title: `章${i}`, content: 'c', summary: '摘'.repeat(3000) }))
    await svc.analyzeConnections(big, 'zh')
    const p = providerMock.generateContent.mock.calls[0][0].prompt as string
    // 6×3000=18000 字被压到「4096×3/4 = 3072」量级（每章至少 400）
    expect(p.length).toBeLessThan(6000)
  })
})
