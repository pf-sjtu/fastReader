/**
 * AI Service - 策略模式实现
 * 统一的 AI 服务接口，通过策略模式支持多种 Provider
 */

import type {
  AICallOptions,
  AIProviderConfig,
  AIServiceOptions,
  Chapter,
  PromptConfig
} from './types'
import type { MindElixirData } from 'mind-elixir'
import type { SupportedLanguage } from '../prompts/utils'
import {
  getFictionChapterSummaryPrompt,
  getNonFictionChapterSummaryPrompt,
  getChapterConnectionsAnalysisPrompt,
  getOverallSummaryPrompt,
  getKeyChartsPrompt,
  getStudyKitPrompt,
  getQuizPrompt,
  getRichRepairPrompt,
  getAskBookPrompt,
  getTestConnectionPrompt,
  getChapterMindMapPrompt,
  getMindMapArrowPrompt,
  getCombinedMindMapPrompt
} from '../prompts'
import { parseCharts, type BookCharts } from '../../charts'
import { extractJsonObject } from '../../charts/parseCharts'
import { parseQuiz, parseStudyKit, type Quiz, type StudyChapter, type StudyKit } from '../../study/schema'
import { getLanguageInstruction } from '../prompts/utils'
import { createAIProvider } from './factory'
import { RESULT_PREFIX } from '../../utils/resultStatus'
import { renderPrompt } from '../prompts/render'
import { splitChapterMeta } from '../prompts/chapterMeta'
import {
  arrowVars,
  chapterVars,
  combinedMindMapVars,
  connectionVars,
  entityTableVars,
  keyChartsVars,
  studyKitVars,
  quizVars,
  richRepairVars,
  askVars,
  overallVars,
  groupChaptersByChars,
  prepareChapterSummariesForPostProcess,
  truncateText,
  usableChapters
} from './promptInputs'
import { logger } from '../../lib/logger'
import { resolveInputBudget, resolvePostProcessLimits, splitByBudget } from './outputBudget'

/** 超长章节分段总结的最大递归层数（每层把分段总结再分段合并） */
const MAX_SEGMENT_DEPTH = 3

// 已跳过章节的标记前缀
const SKIPPED_SUMMARY_PREFIX = RESULT_PREFIX.chapterSkipped

/** 找出文本中所有括号配平的候选片段（跳过字符串内的括号），按出现顺序返回 */
function balancedCandidates(text: string, open: '{' | '['): string[] {
  const close = open === '{' ? '}' : ']'
  const out: string[] = []
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + 1)) {
    let depth = 0
    let inStr = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inStr) {
        if (ch === '\\') i++
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) {
        out.push(text.slice(start, i + 1))
        break
      }
    }
  }
  return out
}

/**
 * 从模型输出中提取 JSON；失败返回 null。
 * 先按贪婪匹配（常见的纯 JSON / 代码围栏），失败后回退为逐个括号配平片段，
 * 以容忍模型在 JSON 前后追加含花括号的说明文字。
 */
function parseJsonMatch<T>(response: string, pattern: RegExp, label: string): T | null {
  const greedy = response.match(pattern)?.[0]
  if (greedy) {
    try {
      return JSON.parse(greedy) as T
    } catch {
      // 继续尝试配平片段
    }
  }
  const open = pattern.source.startsWith('\\[') ? '[' : '{'
  for (const candidate of balancedCandidates(response, open)) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // 试下一个
    }
  }
  if (greedy) logger.error(`${label} JSON 解析失败`)
  return null
}

export class AIService {
  private config: AIProviderConfig | (() => AIProviderConfig)
  private promptConfig: PromptConfig | (() => PromptConfig)
  private options: AIServiceOptions
  private pendingRequests = new Map<string, Promise<string>>()

  constructor(
    config: AIProviderConfig | (() => AIProviderConfig),
    promptConfig?: PromptConfig | (() => PromptConfig),
    options?: AIServiceOptions
  ) {
    this.config = config
    this.promptConfig =
      promptConfig ||
      (() => ({
        chapterSummary: { fiction: '', nonFiction: '' },
        mindmap: { chapter: '', arrow: '', combined: '' },
        connectionAnalysis: '',
        overallSummary: ''
      }))
    this.options = options || {}
  }

  /**
   * 获取当前配置
   */
  private getCurrentConfig(): AIProviderConfig {
    return typeof this.config === 'function' ? this.config() : this.config
  }

  /**
   * 获取当前提示词配置
   */
  private getCurrentPromptConfig(): PromptConfig {
    return typeof this.promptConfig === 'function' ? this.promptConfig() : this.promptConfig
  }

  /**
   * 创建 Provider 实例
   */
  private createProvider() {
    const config = this.getCurrentConfig()
    return createAIProvider(config, this.options)
  }

  /**
   * 生成请求唯一键（用于去重）
   */
  private generateRequestKey(prompt: string, outputLanguage?: SupportedLanguage): string {
    const config = this.getCurrentConfig()
    const data = JSON.stringify({
      prompt,
      model: config.model,
      temperature: config.temperature,
      language: outputLanguage || 'en'
    })
    // 使用简单哈希生成 key
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${config.model}_${Math.abs(hash).toString(36)}`
  }

  /**
   * 生成内容（底层方法，带请求去重）
   */
  private async generateContent(
    prompt: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string> {
    // 带取消信号的请求不参与去重：共享的 promise 会被某一方的取消连带中断
    if (opts?.signal) {
      return this.doGenerateContent(prompt, outputLanguage, opts)
    }

    const key = this.generateRequestKey(prompt, outputLanguage)

    // 检查是否有进行中的相同请求
    if (this.pendingRequests.has(key)) {
      logger.debug('[AIService] 复用进行中的请求:', key)
      return this.pendingRequests.get(key)!
    }

    // 创建新请求
    const promise = this.doGenerateContent(prompt, outputLanguage, opts)
    this.pendingRequests.set(key, promise)

    // 请求完成后移除
    // 注意：finally 会派生新 promise，失败时它同样 reject 且无人处理 → 必须吞掉，错误仍经 promise 本体抛给调用方
    promise
      .finally(() => {
        this.pendingRequests.delete(key)
      })
      .catch(() => {})

    return promise
  }

  /**
   * 实际执行内容生成
   */
  private async doGenerateContent(
    prompt: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string> {
    const provider = this.createProvider()
    const language = outputLanguage || 'en'
    const systemPrompt = getLanguageInstruction(language)

    const response = await provider.generateContent(
      {
        prompt,
        systemPrompt,
        outputLanguage: language
      },
      opts
    )

    if (response.truncated) {
      logger.warn(`[AIService] 模型输出被截断 (finishReason=${response.finishReason})，结果可能不完整`)
      opts?.onTruncated?.({ finishReason: response.finishReason })
    }

    return response.content
  }

  /** 当前模型单次请求可放入的正文字符数（无上下文元数据则不限制） */
  private inputBudget(): number | undefined {
    const c = this.getCurrentConfig()
    return resolveInputBudget(c.contextWindow, c.maxOutputTokens)
  }

  /** map 阶段：按组顺序执行（不并发，避免同时压服务商限流），产出带范围标题的「分段章节」供 reduce 使用 */
  private async mapGroups(
    groups: Chapter[][],
    run: (group: Chapter[]) => Promise<string>
  ): Promise<Array<{ title: string; summary: string }>> {
    const out: Array<{ title: string; summary: string }> = []
    for (const g of groups) {
      const text = (await run(g)).trim()
      if (!text) continue
      out.push({ title: g.length > 1 ? `${g[0].title} … ${g[g.length - 1].title}（共 ${g.length} 章）` : g[0].title, summary: text })
    }
    return out
  }

  /** 后处理（关联 / 全书总结 / 图表 / 整书导图）的压缩上限：按模型上下文窗口计算 */
  private postProcessLimits() {
    const c = this.getCurrentConfig()
    return resolvePostProcessLimits(c.contextWindow, c.maxOutputTokens)
  }

  /**
   * 正文超出模型输入预算时：按段落切分 → 每段用同一章节提示词总结 → 再用同一提示词合并分段总结。
   * 不截断丢内容；切分点只落在段落 / 句末。未超预算时直接单次调用。
   */
  private async generateForLongContent(
    basePrompt: string,
    chapterTitle: string,
    chapterContent: string,
    outputLanguage: SupportedLanguage | undefined,
    opts: AICallOptions | undefined,
    depth = 0
  ): Promise<string> {
    const budget = this.inputBudget()
    // 提示词模板本身也占输入：从预算里扣掉模板长度
    const room = budget ? Math.max(budget - basePrompt.length, 1000) : undefined
    // 到达递归上限时不再切分，交给服务商（超窗会报错，由上层计为失败章节）
    if (!room || chapterContent.length <= room || depth >= MAX_SEGMENT_DEPTH) {
      return this.generateContent(renderPrompt(basePrompt, chapterVars(chapterTitle, chapterContent)), outputLanguage, opts)
    }

    const parts = splitByBudget(chapterContent, room)
    logger.info(`[AIService] 「${chapterTitle}」${chapterContent.length} 字超出模型输入预算 ${room}，分 ${parts.length} 段总结后合并`)
    const partials: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const title = `${chapterTitle}（第 ${i + 1}/${parts.length} 部分）`
      const partial = await this.generateContent(renderPrompt(basePrompt, chapterVars(title, parts[i])), outputLanguage, opts)
      partials.push(splitChapterMeta(partial).text)
    }
    // 合并：把分段总结当作「章节内容」再走一次同一提示词，保证输出格式与普通章节一致。
    // 分段总结合起来仍超预算（极长章节）时递归再分段，每层都显著变短；最多 3 层
    const merged = partials.map((s, i) => `【第 ${i + 1}/${parts.length} 部分总结】\n${s}`).join('\n\n')
    return this.generateForLongContent(
      basePrompt,
      `${chapterTitle}（由 ${parts.length} 段分段总结合并）`,
      merged,
      outputLanguage,
      opts,
      depth + 1
    )
  }

  /**
   * 生成章节总结
   */
  async summarizeChapter(
    chapterTitle: string,
    chapterContent: string,
    bookType: 'fiction' | 'non-fiction',
    outputLanguage?: SupportedLanguage,
    customPrompt?: string,
    opts?: AICallOptions
  ): Promise<string> {
    const promptConfig = this.getCurrentPromptConfig()

    // 如果内容太短，可能是非实质性章节
    if (chapterContent.length < 100) {
      return this.createSkippedSummary('内容太短，可能是非实质性章节')
    }

    // 构建提示词
    const basePrompt =
      bookType === 'fiction'
        ? promptConfig.chapterSummary.fiction || getFictionChapterSummaryPrompt()
        : promptConfig.chapterSummary.nonFiction || getNonFictionChapterSummaryPrompt()

    const prompt = customPrompt || basePrompt
    const withHint = opts?.rewriteHint ? `${prompt}\n\n## 上一次输出存在的问题（本次必须避免）\n${opts.rewriteHint}` : prompt
    return this.generateForLongContent(withHint, chapterTitle, chapterContent, outputLanguage, opts)
  }

  /**
   * 分析章节关联
   * 默认送全文摘要；仅极端长度才压缩。后处理失败应由调用方容错，勿依赖激进截断。
   */
  async analyzeConnections(
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt =
      promptConfig.connectionAnalysis || getChapterConnectionsAnalysisPrompt()

    const usable = usableChapters(chapters)
    const limit = this.postProcessLimits().chapters
    let processedChapters = prepareChapterSummariesForPostProcess(usable, limit)

    if (processedChapters.length < 2) {
      return '章节数量不足，无法分析关联。'
    }

    // 总长超出预算：分组各做一次关联分析（map），再把各组结论当作「章节」交给同一提示词合并（reduce），
    // 而不是把每章砍到几十字——砍掉的细节正是关联分析要找的东西
    const groups = groupChaptersByChars(usable.filter((c) => (c.summary ?? '').trim()), limit)
    if (groups.length > 1) {
      const partials = await this.mapGroups(groups, (g) =>
        g.length < 2
          ? Promise.resolve((g[0].summary ?? '').trim())
          : this.generateContent(
              renderPrompt(basePrompt, [...connectionVars(prepareChapterSummariesForPostProcess(g, limit)), ...entityTableVars(opts?.entityTable)]),
              outputLanguage,
              opts
            )
      )
      processedChapters = prepareChapterSummariesForPostProcess(partials, limit)
      if (processedChapters.length < 2) return partials[0]?.summary ?? ''
    }

    const prompt = renderPrompt(basePrompt, [...connectionVars(processedChapters), ...entityTableVars(opts?.entityTable)])

    return this.generateContent(prompt, outputLanguage, opts)
  }

  /**
   * 生成全书总结
   */
  async generateOverallSummary(
    bookTitle: string,
    chapters: Chapter[],
    connections: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.overallSummary || getOverallSummaryPrompt()

    const usable = usableChapters(chapters)
    const limit = this.postProcessLimits().chapters
    let processedChapters = prepareChapterSummariesForPostProcess(usable, limit)

    if (processedChapters.length === 0) {
      return '没有可用的章节摘要，无法生成全书总结。'
    }

    // 总长超出预算：每组先写一份分段总结（不带关联分析），再用分段总结 + 关联分析写全书总结
    const groups = groupChaptersByChars(usable.filter((c) => (c.summary ?? '').trim()), limit)
    if (groups.length > 1) {
      const partials = await this.mapGroups(groups, (g) =>
        this.generateContent(
          renderPrompt(basePrompt, [...overallVars(bookTitle, prepareChapterSummariesForPostProcess(g, limit), ''), ...entityTableVars(opts?.entityTable)]),
          outputLanguage,
          opts
        )
      )
      processedChapters = prepareChapterSummariesForPostProcess(partials, limit)
    }

    // 关联分析正文同样默认不截；仅超软上限时截
    const connectionsText = truncateText(
      connections || '',
      this.postProcessLimits().connections
    )

    const prompt = renderPrompt(basePrompt, [...overallVars(bookTitle, processedChapters, connectionsText), ...entityTableVars(opts?.entityTable)])

    return this.generateContent(prompt, outputLanguage, opts)
  }

  /**
   * 全书总结后：抽取关键图表结构化数据（实体关系 + 实体时间线）
   * 解析失败抛错，由调用方 soft-fail。
   */
  async generateKeyCharts(
    bookTitle: string,
    chapters: Chapter[],
    connections: string,
    overallSummary: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<BookCharts> {
    const basePrompt = getKeyChartsPrompt()
    // 三份输入（章节摘要 + 关联 + 全书总结）共享一个输入预算：关联配额对半分给关联与全书总结，
    // 否则三份各按上限取会达到预算的 1.25 倍，小窗口模型超窗被拒
    const limits = this.postProcessLimits()
    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters), limits.chapters)

    if (processedChapters.length === 0) {
      throw new Error('没有可用的章节摘要，无法生成关键图表。')
    }

    const half = Math.floor(limits.connections / 2)
    const connectionsText = truncateText(connections || '', half)
    const overallText = truncateText(overallSummary || '', half)

    const prompt = renderPrompt(
      basePrompt,
      [...keyChartsVars(bookTitle, processedChapters, connectionsText, overallText), ...entityTableVars(opts?.entityTable)]
    )

    const response = await this.generateContent(prompt, outputLanguage, opts)
    const charts = parseCharts(response)
    if (!charts) {
      throw new Error('关键图表 JSON 解析失败或无有效数据')
    }
    return charts
  }

  /**
   * 速读包：每章一句话 + 3 要点 + 术语。章节多时按批请求（单次输出过长会被截断），按章合并。
   * 某一批解析失败只丢这一批；全部失败才抛错，调用方 soft-fail。
   */
  async generateStudyKit(
    bookTitle: string,
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions & { onBatch?: (done: number, total: number) => void }
  ): Promise<StudyKit> {
    const limits = this.postProcessLimits()
    const usable = prepareChapterSummariesForPostProcess(usableChapters(chapters), limits.chapters)
    if (usable.length === 0) throw new Error('没有可用的章节摘要，无法生成速读包。')
    const refs = usableChapters(chapters).map((c) => ({ id: c.id, title: c.title }))
    const basePrompt = getStudyKitPrompt()
    const BATCH = 30
    const merged: StudyChapter[] = []
    const batches = Math.ceil(usable.length / BATCH)
    let lastError = ''
    for (let b = 0; b < batches; b++) {
      const slice = usable.slice(b * BATCH, (b + 1) * BATCH).map(({ title, summary }) => ({ title, summary }))
      try {
        const response = await this.generateContent(
          renderPrompt(basePrompt, studyKitVars(bookTitle, slice)),
          outputLanguage,
          opts
        )
        const kit = parseStudyKit(response, refs)
        if (kit) merged.push(...kit.chapters)
        else lastError = '速读包 JSON 解析失败或无有效数据'
      } catch (e) {
        if (opts?.signal?.aborted) throw e
        lastError = e instanceof Error ? e.message : String(e)
      }
      opts?.onBatch?.(b + 1, batches)
    }
    if (!merged.length) throw new Error(lastError || '速读包生成失败')
    return { version: 1, chapters: merged }
  }

  /** 自测题：scope 为空 = 全书；否则只用这些章节（按章自测） */
  async generateQuiz(
    bookTitle: string,
    chapters: Chapter[],
    count: number,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<Quiz> {
    const limits = this.postProcessLimits()
    const usable = usableChapters(chapters)
    const prepared = prepareChapterSummariesForPostProcess(usable, limits.chapters).map(({ title, summary }) => ({ title, summary }))
    if (prepared.length === 0) throw new Error('没有可用的章节摘要，无法出题。')
    const response = await this.generateContent(
      renderPrompt(getQuizPrompt(), quizVars(bookTitle, count, prepared)),
      outputLanguage,
      opts
    )
    const quiz = parseQuiz(response, usable.map((c) => ({ id: c.id, title: c.title })))
    if (!quiz) throw new Error('自测题 JSON 解析失败或无有效题目')
    return quiz
  }

  /** 富内容块统一修复：一批坏块一次调用；解析不出来返回空数组（调用方当作全部放弃） */
  async repairRichBlocks(
    items: { id: number; lang: string; error: string; code: string; context: string }[],
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<{ id: number; code: string | null }[]> {
    const response = await this.generateContent(renderPrompt(getRichRepairPrompt(), richRepairVars(items)), outputLanguage, opts)
    const json = extractJsonObject(response)
    if (!json) return []
    try {
      const fixes = (JSON.parse(json) as { fixes?: { id?: unknown; code?: unknown }[] }).fixes
      return (Array.isArray(fixes) ? fixes : [])
        .filter((f) => Number.isInteger(f?.id))
        .map((f) => ({ id: f.id as number, code: typeof f.code === 'string' ? f.code : null }))
    } catch {
      return []
    }
  }

  /** 问书：材料（全书总结 + 检索出的章节）由调用方组装好；返回原始回答文本（含【章节】引用） */
  async askBook(
    bookTitle: string,
    overallSummary: string,
    context: string,
    history: string,
    question: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<string> {
    const limits = this.postProcessLimits()
    const prompt = renderPrompt(
      getAskBookPrompt(),
      askVars(bookTitle, truncateText(overallSummary || '', Math.floor(limits.connections / 2)), context, history, question)
    )
    return (await this.generateContent(prompt, outputLanguage, opts)).trim()
  }

  /**
   * 生成章节思维导图
   */
  async generateChapterMindMap(
    chapterTitle: string,
    chapterContent: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions,
    bookType: 'fiction' | 'non-fiction' = 'non-fiction'
  ): Promise<MindElixirData | null> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.chapter || getChapterMindMapPrompt()

    // 导图是 JSON 树，分段结果无法可靠合并：正文超出模型输入预算时，先用章节总结流程（分段 → 合并）
    // 把正文压缩成完整摘要，再以摘要生成导图。未超预算时不变。压缩用与本书类型对应的章节总结提示词。
    const budget = this.inputBudget()
    const room = budget ? Math.max(budget - basePrompt.length, 1000) : undefined
    let content = chapterContent
    if (room && chapterContent.length > room) {
      const condensePrompt =
        bookType === 'fiction'
          ? promptConfig.chapterSummary.fiction || getFictionChapterSummaryPrompt()
          : promptConfig.chapterSummary.nonFiction || getNonFictionChapterSummaryPrompt()
      content = await this.generateForLongContent(condensePrompt, chapterTitle, chapterContent, outputLanguage, opts)
    }

    const prompt = renderPrompt(basePrompt, chapterVars(chapterTitle, content))

    const response = await this.generateContent(prompt, outputLanguage, opts)
    return parseJsonMatch<MindElixirData>(response, /\{[\s\S]*\}/, '思维导图')
  }

  /**
   * 生成章节间关联箭头
   */
  async generateMindMapArrows(
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<Array<{ from: string; to: string; label: string }>> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.arrow || getMindMapArrowPrompt()

    // 与其它后处理一致：总长超出模型上下文换算的上限时按章均分压缩（id 不变，箭头仍能对上）
    const usable = usableChapters(chapters)
    const compressed = prepareChapterSummariesForPostProcess(usable, this.postProcessLimits().chapters)
    const chapterList = usable.map((chapter, index) => ({
      index: index + 1,
      id: chapter.id,
      title: chapter.title,
      summary: compressed[index]?.summary ?? chapter.summary
    }))

    const prompt = renderPrompt(basePrompt, arrowVars(chapterList))

    const response = await this.generateContent(prompt, outputLanguage, opts)
    return (
      parseJsonMatch<Array<{ from: string; to: string; label: string }>>(response, /\[[\s\S]*\]/, '箭头') ?? []
    )
  }

  /**
   * 生成完整思维导图
   */
  async generateCombinedMindMap(
    bookTitle: string,
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<MindElixirData | null> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.combined || getCombinedMindMapPrompt()

    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters), this.postProcessLimits().chapters)

    if (processedChapters.length === 0) {
      return null
    }

    const prompt = renderPrompt(basePrompt, combinedMindMapVars(bookTitle, processedChapters))

    const response = await this.generateContent(prompt, outputLanguage, opts)
    return parseJsonMatch<MindElixirData>(response, /\{[\s\S]*\}/, '思维导图')
  }

  /**
   * 测试 AI 连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const provider = this.createProvider()
      const result = await provider.testConnection()

      if (result.success) {
        // 额外测试一次实际生成
        const testPrompt = getTestConnectionPrompt()
        await this.generateContent(testPrompt, 'en')
      }

      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 创建已跳过的总结
   */
  static createSkippedSummary(reason?: string): string {
    const details = reason?.trim()
    if (details) {
      return `${SKIPPED_SUMMARY_PREFIX} 触发内容过滤：${details}`
    }
    return `${SKIPPED_SUMMARY_PREFIX} 触发内容过滤，已跳过该章节`
  }

  /**
   * 检查是否为已跳过的总结
   */
  static isSkippedSummary(summary: string): boolean {
    return summary.trim().startsWith(SKIPPED_SUMMARY_PREFIX)
  }

  /**
   * 实例方法：创建已跳过的总结
   */
  private createSkippedSummary(reason?: string): string {
    return AIService.createSkippedSummary(reason)
  }
}

// 导出兼容的静态方法
export { SKIPPED_SUMMARY_PREFIX }
