import { describe, it, expect, vi } from 'vitest'
import {
  chapterPhaseMax,
  runBookPipeline,
  type PipelineAI,
  type PipelineCache,
  type RunBookPipelineInput,
} from '../src/services/pipeline/bookPipeline'
import { RESULT_PREFIX } from '../src/utils/resultStatus'

const chapters = [
  { id: 'c1', title: '第一章', content: 'A'.repeat(200), extra: 'x' },
  { id: 'c2', title: '第二章', content: 'B'.repeat(200) },
  { id: 'c3', title: '第三章', content: 'C'.repeat(200) },
]

const mm = (topic: string) => ({ nodeData: { id: 'root', topic, children: [{ id: 'a', topic: `${topic}-子` }] } })

function makeAI(overrides: Partial<Record<keyof PipelineAI, unknown>> = {}) {
  const ai = {
    summarizeChapter: vi.fn(async (title: string) => `摘要:${title}`),
    analyzeConnections: vi.fn(async () => '关联'),
    generateOverallSummary: vi.fn(async () => '全书'),
    generateKeyCharts: vi.fn(async () => ({ version: 1 })),
    generateChapterMindMap: vi.fn(async (title: string) => mm(title)),
    generateCombinedMindMap: vi.fn(async () => mm('整书')),
    ...overrides,
  }
  return ai as unknown as PipelineAI & Record<keyof PipelineAI, ReturnType<typeof vi.fn>>
}

function memoryCache() {
  const store = new Map<string, unknown>()
  const cache: PipelineCache = {
    getChapter: async (kind, ch) => store.get(`${kind}:${ch.id}:${ch.content}`) ?? null,
    setChapter: async (kind, ch, v) => void store.set(`${kind}:${ch.id}:${ch.content}`, v),
    getBook: async (kind, input) => store.get(`${kind}:${input}`) ?? null,
    setBook: async (kind, input, v) => void store.set(`${kind}:${input}`, v),
  }
  return { cache, store }
}

const base = (ai: PipelineAI, extra: Partial<RunBookPipelineInput> = {}): RunBookPipelineInput => ({
  chapters,
  mode: 'summary',
  ai,
  bookTitle: '书',
  bookType: 'non-fiction',
  outputLanguage: 'zh',
  concurrency: 2,
  ...extra,
})

describe('runBookPipeline · summary', () => {
  it('全部成功：章节有序提交、后处理与图表、进度与阶段回调', async () => {
    const ai = makeAI()
    const onChapter = vi.fn()
    const onPhase = vi.fn()
    const onChapterStart = vi.fn()
    const res = await runBookPipeline(base(ai, { onChapter, onPhase, onChapterStart, customPrompt: 'P' }))

    expect(res.chapters.map((c) => c.summary)).toEqual(['摘要:第一章', '摘要:第二章', '摘要:第三章'])
    expect(res.chapters[0]).toEqual({ id: 'c1', title: '第一章', content: 'A'.repeat(200), summary: '摘要:第一章', processed: true })
    expect(res).toMatchObject({ connections: '关联', overall: '全书', charts: { version: 1 }, isPartial: false, warnings: [] })
    expect(res.stats).toEqual({ total: 3, usable: 3, failed: 0, skipped: 0, cached: 0 })
    expect(onChapter.mock.calls.map((c) => c[1])).toEqual([0, 1, 2])
    expect(onChapter.mock.calls.at(-1)?.[2]).toEqual({ fromCache: false, progress: 80 })
    expect(onPhase.mock.calls.map((c) => c[0])).toEqual(['chapters', 'connections', 'overall', 'charts'])
    expect(onChapterStart).toHaveBeenCalledTimes(3)
    // 自定义 prompt 与 signal 透传
    expect(ai.summarizeChapter.mock.calls[0][4]).toBe('P')
    expect(ai.summarizeChapter.mock.calls[0][5]).toHaveProperty('signal')
  })

  it('单章失败：标记失败、后处理只喂可用章节、isPartial', async () => {
    const ai = makeAI({
      summarizeChapter: vi.fn(async (title: string) => {
        if (title === '第二章') throw new Error('超时')
        return `摘要:${title}`
      }),
    })
    const res = await runBookPipeline(base(ai))
    expect(res.chapters[1]).toMatchObject({ processed: false, summary: `${RESULT_PREFIX.chapterFailed}超时` })
    expect(ai.analyzeConnections.mock.calls[0][0].map((c: { id: string }) => c.id)).toEqual(['c1', 'c3'])
    expect(res.isPartial).toBe(true)
    expect(res.warnings).toContain('chapters')
    expect(res.stats.failed).toBe(1)
  })

  it('跳过占位计入 skipped 且 isPartial；关联失败仍做全书总结', async () => {
    const ai = makeAI({
      summarizeChapter: vi.fn(async (title: string) =>
        title === '第一章' ? `${RESULT_PREFIX.chapterSkipped} 内容太短` : `摘要:${title}`
      ),
      analyzeConnections: vi.fn(async () => {
        throw new Error('关联挂了')
      }),
    })
    const res = await runBookPipeline(base(ai))
    expect(res.stats.skipped).toBe(1)
    expect(res.connections.startsWith(RESULT_PREFIX.connectionsFailed)).toBe(true)
    expect(ai.generateOverallSummary.mock.calls[0][2]).toBe('')
    expect(res.overall).toBe('全书')
    expect(res.warnings).toEqual(['connections'])
    expect(res.isPartial).toBe(true)
  })

  it('全书总结失败则不生成图表；图表失败记 chartsError；可关闭图表', async () => {
    const ai1 = makeAI({ generateOverallSummary: vi.fn(async () => Promise.reject(new Error('x'))) })
    const r1 = await runBookPipeline(base(ai1))
    expect(r1.overall.startsWith(RESULT_PREFIX.overallFailed)).toBe(true)
    expect(ai1.generateKeyCharts).not.toHaveBeenCalled()
    expect(r1.isPartial).toBe(true)

    const ai2 = makeAI({ generateKeyCharts: vi.fn(async () => Promise.reject(new Error('图表坏'))) })
    const r2 = await runBookPipeline(base(ai2))
    expect(r2).toMatchObject({ charts: null, chartsError: '图表坏', isPartial: false })
    expect(r2.warnings).toEqual(['charts'])

    const ai3 = makeAI()
    await runBookPipeline(base(ai3, { generateCharts: false }))
    expect(ai3.generateKeyCharts).not.toHaveBeenCalled()
  })

  it('全部失败：不做后处理', async () => {
    const ai = makeAI({ summarizeChapter: vi.fn(async () => Promise.reject(new Error('挂'))) })
    const res = await runBookPipeline(base(ai))
    expect(ai.analyzeConnections).not.toHaveBeenCalled()
    expect(res).toMatchObject({ connections: '', overall: '', isPartial: true })
    expect(res.stats.usable).toBe(0)
  })

  it('缓存：第二次运行全部命中，不再调用 AI；失败章节不入缓存只重跑它', async () => {
    const { cache } = memoryCache()
    let failSecond = true
    const ai = makeAI({
      summarizeChapter: vi.fn(async (title: string) => {
        if (title === '第二章' && failSecond) throw new Error('临时失败')
        return `摘要:${title}`
      }),
    })
    const afterChapterAI = vi.fn(async () => {})
    await runBookPipeline(base(ai, { cache, afterChapterAI }))
    expect(ai.summarizeChapter).toHaveBeenCalledTimes(3)
    expect(afterChapterAI).toHaveBeenCalledTimes(3)

    failSecond = false
    ai.summarizeChapter.mockClear()
    const onChapter = vi.fn()
    const r2 = await runBookPipeline(base(ai, { cache, onChapter, afterChapterAI }))
    expect(ai.summarizeChapter).toHaveBeenCalledTimes(1)
    expect(ai.summarizeChapter.mock.calls[0][0]).toBe('第二章')
    expect(r2.stats.cached).toBe(2)
    expect(onChapter.mock.calls[0][2].fromCache).toBe(true)

    // 第三次：章节与书级结果全部命中，零 AI 调用
    for (const fn of Object.values(ai)) fn.mockClear()
    const r3 = await runBookPipeline(base(ai, { cache }))
    expect(Object.values(ai).every((fn) => fn.mock.calls.length === 0)).toBe(true)
    expect(r3).toMatchObject({ connections: '关联', overall: '全书', charts: { version: 1 }, isPartial: false })
  })

  it('缓存读写抛错不影响主流程', async () => {
    const broken: PipelineCache = {
      getChapter: async () => Promise.reject(new Error('r')),
      setChapter: async () => Promise.reject(new Error('w')),
      getBook: async () => Promise.reject(new Error('r')),
      setBook: async () => Promise.reject(new Error('w')),
    }
    const res = await runBookPipeline(base(makeAI(), { cache: broken }))
    expect(res.stats.usable).toBe(3)
    expect(res.overall).toBe('全书')
  })

  it('取消：进行中请求被中止时整体以 AbortError 结束，不吞成失败章节', async () => {
    const controller = new AbortController()
    const ai = makeAI({
      summarizeChapter: vi.fn(
        (_t: string, _c: string, _b: string, _l: string, _p: string, opts: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          )
      ),
    })
    const pending = runBookPipeline(base(ai, { signal: controller.signal }))
    await vi.waitFor(() => expect(ai.summarizeChapter).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const pre = new AbortController()
    pre.abort()
    await expect(runBookPipeline(base(makeAI(), { signal: pre.signal }))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('后处理阶段取消同样抛 AbortError', async () => {
    const controller = new AbortController()
    const ai = makeAI({
      analyzeConnections: vi.fn(async () => {
        controller.abort()
        throw new Error('被取消后的普通错误')
      }),
    })
    await expect(runBookPipeline(base(ai, { signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('runBookPipeline · mindmap', () => {
  it('章节导图：null 解析结果标为失败；不调用整书导图', async () => {
    const ai = makeAI({
      generateChapterMindMap: vi.fn(async (title: string) => (title === '第三章' ? null : mm(title))),
    })
    const res = await runBookPipeline(base(ai, { mode: 'mindmap' }))
    expect(res.chapters.map((c) => c.processed)).toEqual([true, true, false])
    expect(res.chapters[0].mindMap).toEqual(mm('第一章'))
    expect(ai.generateCombinedMindMap).not.toHaveBeenCalled()
    expect(res).toMatchObject({ isPartial: true, combinedMindMap: null })
    expect(res.stats).toMatchObject({ usable: 2, failed: 1 })
  })

  it('整书导图：输入为可用章节拍平文本；成功与失败（null）', async () => {
    const ai = makeAI()
    const onPhase = vi.fn()
    const res = await runBookPipeline(base(ai, { mode: 'combined-mindmap', onPhase }))
    expect(res.combinedMindMap).toEqual(mm('整书'))
    expect(ai.generateCombinedMindMap.mock.calls[0][1][0].summary).toBe('- 第一章-子')
    expect(onPhase).toHaveBeenCalledWith('combined', 90)
    expect(res.isPartial).toBe(false)

    const ai2 = makeAI({ generateCombinedMindMap: vi.fn(async () => null) })
    const r2 = await runBookPipeline(base(ai2, { mode: 'combined-mindmap' }))
    expect(r2).toMatchObject({ combinedMindMap: null, isPartial: true, warnings: ['combined'] })
  })

  it('导图缓存：命中后不调用 AI', async () => {
    const { cache } = memoryCache()
    const ai = makeAI()
    await runBookPipeline(base(ai, { mode: 'combined-mindmap', cache }))
    for (const fn of Object.values(ai)) fn.mockClear()
    const res = await runBookPipeline(base(ai, { mode: 'combined-mindmap', cache }))
    expect(ai.generateChapterMindMap).not.toHaveBeenCalled()
    expect(ai.generateCombinedMindMap).not.toHaveBeenCalled()
    expect(res.stats.cached).toBe(3)
  })

  it('章节阶段进度上限按模式', () => {
    expect(chapterPhaseMax('summary')).toBe(80)
    expect(chapterPhaseMax('mindmap')).toBe(95)
    expect(chapterPhaseMax('combined-mindmap')).toBe(85)
  })

  it('空章节列表直接返回', async () => {
    const res = await runBookPipeline(base(makeAI(), { chapters: [] }))
    expect(res.chapters).toEqual([])
    expect(res.isPartial).toBe(false)
  })
})
