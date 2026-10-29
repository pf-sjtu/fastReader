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
  getTestConnectionPrompt,
  getChapterMindMapPrompt,
  getMindMapArrowPrompt,
  getCombinedMindMapPrompt
} from '../prompts'
import { parseCharts, type BookCharts } from '../../charts'
import { getLanguageInstruction } from '../prompts/utils'
import { createAIProvider } from './factory'
import { RESULT_PREFIX } from '../../utils/resultStatus'
import { renderPrompt } from '../prompts/render'
import {
  POST_PROCESS_CONNECTIONS_SOFT_LIMIT,
  arrowVars,
  chapterVars,
  combinedMindMapVars,
  connectionVars,
  keyChartsVars,
  overallVars,
  prepareChapterSummariesForPostProcess,
  truncateText,
  usableChapters
} from './promptInputs'
import { logger } from '../../lib/logger'

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

    const prompt = renderPrompt(customPrompt || basePrompt, chapterVars(chapterTitle, chapterContent))

    return this.generateContent(prompt, outputLanguage, opts)
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

    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters))

    if (processedChapters.length < 2) {
      return '章节数量不足，无法分析关联。'
    }

    const prompt = renderPrompt(basePrompt, connectionVars(processedChapters))

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

    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters))

    if (processedChapters.length === 0) {
      return '没有可用的章节摘要，无法生成全书总结。'
    }

    // 关联分析正文同样默认不截；仅超软上限时截
    const connectionsText = truncateText(
      connections || '',
      POST_PROCESS_CONNECTIONS_SOFT_LIMIT
    )

    const prompt = renderPrompt(basePrompt, overallVars(bookTitle, processedChapters, connectionsText))

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
    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters))

    if (processedChapters.length === 0) {
      throw new Error('没有可用的章节摘要，无法生成关键图表。')
    }

    const connectionsText = truncateText(
      connections || '',
      POST_PROCESS_CONNECTIONS_SOFT_LIMIT
    )
    const overallText = truncateText(
      overallSummary || '',
      POST_PROCESS_CONNECTIONS_SOFT_LIMIT
    )

    const prompt = renderPrompt(
      basePrompt,
      keyChartsVars(bookTitle, processedChapters, connectionsText, overallText)
    )

    const response = await this.generateContent(prompt, outputLanguage, opts)
    const charts = parseCharts(response)
    if (!charts) {
      throw new Error('关键图表 JSON 解析失败或无有效数据')
    }
    return charts
  }

  /**
   * 生成章节思维导图
   */
  async generateChapterMindMap(
    chapterTitle: string,
    chapterContent: string,
    outputLanguage?: SupportedLanguage,
    opts?: AICallOptions
  ): Promise<MindElixirData | null> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.chapter || getChapterMindMapPrompt()

    const prompt = renderPrompt(basePrompt, chapterVars(chapterTitle, chapterContent))

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

    const chapterList = usableChapters(chapters).map((chapter, index) => ({
      index: index + 1,
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary
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

    const processedChapters = prepareChapterSummariesForPostProcess(usableChapters(chapters))

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
