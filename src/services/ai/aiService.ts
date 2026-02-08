/**
 * AI Service - 策略模式实现
 * 统一的 AI 服务接口，通过策略模式支持多种 Provider
 */

import type {
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
  getTestConnectionPrompt,
  getChapterMindMapPrompt,
  getMindMapArrowPrompt
} from '../prompts'
import { getLanguageInstruction } from '../prompts/utils'
import { createAIProvider } from './factory'

// 已跳过章节的标记前缀
const SKIPPED_SUMMARY_PREFIX = '【已跳过】'

export class AIService {
  private config: AIProviderConfig | (() => AIProviderConfig)
  private promptConfig: PromptConfig | (() => PromptConfig)
  private options: AIServiceOptions

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
   * 生成内容（底层方法）
   */
  private async generateContent(
    prompt: string,
    outputLanguage?: SupportedLanguage
  ): Promise<string> {
    const provider = this.createProvider()
    const language = outputLanguage || 'en'
    const systemPrompt = getLanguageInstruction(language)

    const response = await provider.generateContent({
      prompt,
      systemPrompt,
      outputLanguage: language
    })

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
    customPrompt?: string
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

    const prompt = customPrompt
      ? `${customPrompt}\n\n章节标题: ${chapterTitle}\n\n章节内容:\n${chapterContent}`
      : `${basePrompt}\n\n章节标题: ${chapterTitle}\n\n章节内容:\n${chapterContent}`

    return this.generateContent(prompt, outputLanguage)
  }

  /**
   * 分析章节关联
   */
  async analyzeConnections(
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage
  ): Promise<string> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt =
      promptConfig.connectionAnalysis || getChapterConnectionsAnalysisPrompt()

    const processedChapters = chapters
      .filter(ch => !this.isSkippedSummary(ch.summary || ''))
      .map((chapter, index) => ({
        index: index + 1,
        title: chapter.title,
        summary: chapter.summary
      }))

    if (processedChapters.length < 2) {
      return '章节数量不足，无法分析关联。'
    }

    const prompt = `${basePrompt}\n\n已处理的章节列表:\n${JSON.stringify(processedChapters, null, 2)}`

    return this.generateContent(prompt, outputLanguage)
  }

  /**
   * 生成全书总结
   */
  async generateOverallSummary(
    bookTitle: string,
    chapters: Chapter[],
    connections: string,
    outputLanguage?: SupportedLanguage
  ): Promise<string> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.overallSummary || getOverallSummaryPrompt()

    const processedChapters = chapters
      .filter(ch => !this.isSkippedSummary(ch.summary || ''))
      .map((chapter, index) => ({
        index: index + 1,
        title: chapter.title,
        summary: chapter.summary
      }))

    const prompt = `${basePrompt}\n\n书名: ${bookTitle}\n\n已处理的章节列表:\n${JSON.stringify(processedChapters, null, 2)}\n\n章节关联分析:\n${connections}`

    return this.generateContent(prompt, outputLanguage)
  }

  /**
   * 生成章节思维导图
   */
  async generateChapterMindMap(
    chapterTitle: string,
    chapterContent: string,
    outputLanguage?: SupportedLanguage
  ): Promise<MindElixirData | null> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.chapter || getChapterMindMapPrompt()

    const prompt = `${basePrompt}\n\n章节标题: ${chapterTitle}\n\n章节内容:\n${chapterContent}`

    const response = await this.generateContent(prompt, outputLanguage)

    try {
      // 尝试从响应中提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as MindElixirData
      }
    } catch (error) {
      console.error('思维导图 JSON 解析失败:', error)
    }

    return null
  }

  /**
   * 生成章节间关联箭头
   */
  async generateMindMapArrows(
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage
  ): Promise<Array<{ from: string; to: string; label: string }>> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.arrow || getMindMapArrowPrompt()

    const chapterList = chapters
      .filter(ch => !this.isSkippedSummary(ch.summary || ''))
      .map((chapter, index) => ({
        index: index + 1,
        id: chapter.id,
        title: chapter.title,
        summary: chapter.summary
      }))

    const prompt = `${basePrompt}\n\n章节列表:\n${JSON.stringify(chapterList, null, 2)}`

    const response = await this.generateContent(prompt, outputLanguage)

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (error) {
      console.error('箭头 JSON 解析失败:', error)
    }

    return []
  }

  /**
   * 生成完整思维导图
   */
  async generateCombinedMindMap(
    bookTitle: string,
    chapters: Chapter[],
    outputLanguage?: SupportedLanguage
  ): Promise<MindElixirData | null> {
    const promptConfig = this.getCurrentPromptConfig()
    const basePrompt = promptConfig.mindmap.combined || getChapterMindMapPrompt()

    const processedChapters = chapters
      .filter(ch => !this.isSkippedSummary(ch.summary || ''))
      .map((chapter, index) => ({
        index: index + 1,
        title: chapter.title,
        summary: chapter.summary
      }))

    const prompt = `${basePrompt}\n\n书名: ${bookTitle}\n\n章节列表:\n${JSON.stringify(processedChapters, null, 2)}`

    const response = await this.generateContent(prompt, outputLanguage)

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as MindElixirData
      }
    } catch (error) {
      console.error('思维导图 JSON 解析失败:', error)
    }

    return null
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

  /**
   * 实例方法：检查是否为已跳过的总结
   */
  private isSkippedSummary(summary: string): boolean {
    return AIService.isSkippedSummary(summary)
  }
}

// 导出兼容的静态方法
export { SKIPPED_SUMMARY_PREFIX }
