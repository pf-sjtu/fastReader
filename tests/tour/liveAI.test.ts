// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:38124" }
/**
 * 真实 AI 服务商联调（长期保留，默认跳过）。
 * 链路与线上浏览器一致：前端 provider → 同源 /api/ai（真实的 Pages Function 代码，本机模拟运行时）→ 真实模型网关。
 *
 * 运行：E2E_CONFIG=<Web 端导出的配置 yaml> pnpm exec vitest run tests/tour/liveAI.test.ts
 * 可选：E2E_MODEL=<用于内容生成的模型名，默认取配置里名字含 flash 的，否则第一个>
 * 成本：每个服务商 1 次最小连通性请求 + 约 10 次极短内容生成；不打印任何密钥。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { onRequest as aiProxy } from '../../functions/api/ai/[[path]].js'
import { startPagesEmulator, patchRelativeFetch } from './pagesEmulator'
import { AIService } from '../../src/services/ai/aiService'
import type { PromptConfig } from '../../src/services/ai/types'
import type { AIProviderConfig } from '../../src/stores/types'
import { runBookPipeline, type PipelineAI, type PipelineCache } from '../../src/services/pipeline/bookPipeline'
import { isUsableText } from '../../src/utils/resultStatus'

const CONFIG_PATH = process.env.E2E_CONFIG
const live = describe.skipIf(!CONFIG_PATH)

let providers: AIProviderConfig[] = []
let promptConfig: PromptConfig
let main: AIProviderConfig // 内容生成用的服务商（尽量选便宜的）

const CH1 = '光合作用是植物利用光能，把二氧化碳和水转化为有机物并释放氧气的过程。它发生在叶绿体中，分为光反应和暗反应两个阶段。光反应在类囊体膜上进行，产生 ATP 和 NADPH；暗反应在基质中利用这些能量固定二氧化碳。'
const CH2 = '市场经济依靠价格信号配置资源。当某种商品供不应求时价格上升，生产者因此增加供给，消费者则减少需求，直到供求重新平衡。这一机制被亚当·斯密称为“看不见的手”，但它在存在外部性或垄断时会失灵，需要制度加以矫正。'

const PORT = 38124
const ORIGIN = `http://localhost:${PORT}`
let server: Server | undefined
let restoreFetch: (() => void) | undefined

afterAll(async () => {
  restoreFetch?.()
  if (server) await new Promise((r) => server!.close(r))
})

beforeAll(async () => {
  if (!CONFIG_PATH) return
  server = await startPagesEmulator({
    port: PORT,
    origin: ORIGIN,
    routes: { '/api/ai': aiProxy },
    trace: !!process.env.E2E_TRACE,
  })
  restoreFetch = patchRelativeFetch(ORIGIN)
  const raw = parse(readFileSync(CONFIG_PATH as string, 'utf8'))
  const cfg = raw?.config ?? raw
  providers = (cfg.aiConfigManager?.providers ?? []).map((p: AIProviderConfig) => ({
    ...p,
    customFields: p.customFields ?? {},
  }))
  const version = cfg.currentPromptVersion ?? 'v2'
  promptConfig = cfg.promptVersionConfig[version] // 用户真实保存的提示词
  const want = process.env.E2E_MODEL
  main =
    providers.find((p) => p.model === want) ??
    providers.find((p) => /flash/i.test(p.model)) ??
    providers[0]
  if (!main) throw new Error('配置里没有 AI 服务商')
})

const service = (cfg: AIProviderConfig = main, opts = {}) => new AIService(cfg, () => promptConfig, opts)

live('各服务商连通性（每个 1 次最小请求）', () => {
  // 模型名在收集阶段未知（要读文件），用 5 个固定下标，名称在断言信息里给出
  it.each([0, 1, 2, 3, 4])('服务商 #%i 可连通并能生成', async (i) => {
    const cfg = providers[i]
    if (!cfg) return // 配置里服务商不足 5 个
    const started = Date.now()
    const res = await service(cfg).testConnection()
    // 网关明确表示该模型不存在属于配置问题，不是代码缺陷：记录告警，不算失败
    if (/model_not_found|does not exist|无可用渠道/i.test(res.error ?? '')) {
      console.warn(`[live-ai] ${cfg.model} 网关拒绝：${(res.error ?? '').slice(0, 120)}`)
      return
    }
    expect(res.error ?? '', `${cfg.model} 连通失败`).toBe('')
    expect(res.success).toBe(true)
    console.log(`[live-ai] ${cfg.model} ok ${Date.now() - started}ms`)
  }, 120_000)
})

live('内容生成（真实模型 + 用户保存的 prompt）', () => {
  it('章节总结：使用已保存的 v2 提示词，输出为非空中文且无字面占位符', async () => {
    const text = await service().summarizeChapter('光合作用', CH1, 'non-fiction', 'zh')
    expect(isUsableText(text)).toBe(true)
    expect(text).toMatch(/[一-龥]/)
    expect(text).not.toMatch(/\{\{/)
    expect(text.length).toBeGreaterThan(40)
  }, 180_000)

  it('章节思维导图：模型输出能被解析为 mind-elixir 结构', async () => {
    const mm = await service().generateChapterMindMap('市场经济', CH2, 'zh')
    expect(mm).not.toBeNull()
    expect(typeof mm!.nodeData.topic).toBe('string')
    expect(mm!.nodeData.topic.length).toBeGreaterThan(0)
    expect(Array.isArray(mm!.nodeData.children)).toBe(true)
    expect(mm!.nodeData.children!.length).toBeGreaterThan(0)
  }, 180_000)
})

live('取消与错误分类（真实网络）', () => {
  it('在途请求被 abort：快速以 AbortError 结束', async () => {
    const ctrl = new AbortController()
    const started = Date.now()
    const p = service().summarizeChapter('光合作用', CH1.repeat(8), 'non-fiction', 'zh', undefined, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 300)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(3000)
  }, 30_000)

  it('无效密钥（401）立即失败，不进入重试退避', async () => {
    const bad = { ...main, apiKey: 'sk-invalid-key-for-e2e' }
    const started = Date.now()
    // 若 401 被错误地重试（3 次，基数 2s → ≥ 6s），耗时会明显超出
    const svc = service(bad, { maxRetries: 3, baseRetryDelay: 2000 })
    await expect(svc.summarizeChapter('t', CH1, 'non-fiction', 'zh')).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5000)
  }, 30_000)
})

live('整条管线（真实 AI + 内存缓存）', () => {
  function countingAI(real: AIService): { ai: PipelineAI; calls: () => number } {
    let n = 0
    const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
      (...a: A) => {
        n++
        return fn(...a)
      }
    const ai: PipelineAI = {
      summarizeChapter: wrap(real.summarizeChapter.bind(real)),
      analyzeConnections: wrap(real.analyzeConnections.bind(real)),
      generateOverallSummary: wrap(real.generateOverallSummary.bind(real)),
      generateKeyCharts: wrap(real.generateKeyCharts.bind(real)),
      generateChapterMindMap: wrap(real.generateChapterMindMap.bind(real)),
      generateCombinedMindMap: wrap(real.generateCombinedMindMap.bind(real)),
    }
    return { ai, calls: () => n }
  }

  function memoryCache(): PipelineCache {
    const m = new Map<string, unknown>()
    return {
      getChapter: async (k, c) => m.get(`c:${k}:${c.id}:${c.content.length}`),
      setChapter: async (k, c, v) => void m.set(`c:${k}:${c.id}:${c.content.length}`, v),
      getBook: async (k, input) => m.get(`b:${k}:${input}`),
      setBook: async (k, input, v) => void m.set(`b:${k}:${input}`, v),
    }
  }

  const chapters = [
    { id: 'chapter-1', title: '光合作用', content: CH1 },
    { id: 'chapter-2', title: '市场经济', content: CH2 },
  ]

  it('summary 模式：章节按序产出，后处理成功；第二次运行命中缓存且零 AI 调用', async () => {
    const cache = memoryCache()
    const { ai, calls } = countingAI(service())
    const order: number[] = []

    const first = await runBookPipeline({
      chapters,
      mode: 'summary',
      ai,
      bookTitle: '联调小书',
      bookType: 'non-fiction',
      outputLanguage: 'zh',
      concurrency: 2,
      cache,
      generateCharts: false,
      onChapter: (_c, index) => order.push(index),
    })
    expect(order).toEqual([0, 1]) // 并行也按章节顺序提交
    if (first.stats.usable !== 2) console.warn('[live-ai] 章节摘要状态', first.chapters.map((c) => String(c.summary).slice(0, 80)))
    expect(first.stats).toMatchObject({ total: 2, usable: 2, failed: 0 })
    expect(first.isPartial).toBe(false)
    expect(first.chapters.every((c) => isUsableText(c.summary))).toBe(true)
    expect(isUsableText(first.connections)).toBe(true)
    expect(isUsableText(first.overall)).toBe(true)
    const firstCalls = calls()
    expect(firstCalls).toBeGreaterThanOrEqual(4) // 2 章 + 关联 + 全书

    const second = await runBookPipeline({
      chapters,
      mode: 'summary',
      ai,
      bookTitle: '联调小书',
      bookType: 'non-fiction',
      outputLanguage: 'zh',
      concurrency: 2,
      cache,
      generateCharts: false,
    })
    expect(second.stats.cached).toBe(2)
    expect(calls()).toBe(firstCalls) // 零新增 AI 调用
    expect(second.chapters.map((c) => c.summary)).toEqual(first.chapters.map((c) => c.summary))
  }, 300_000)

  it('mindmap 模式：每章产出可用导图', async () => {
    const { ai } = countingAI(service())
    const res = await runBookPipeline({
      chapters,
      mode: 'mindmap',
      ai,
      bookTitle: '联调小书',
      bookType: 'non-fiction',
      outputLanguage: 'zh',
      concurrency: 2,
    })
    expect(res.stats.failed).toBe(0)
    expect(res.chapters.every((c) => !!c.mindMap?.nodeData?.topic)).toBe(true)
  }, 300_000)
})
