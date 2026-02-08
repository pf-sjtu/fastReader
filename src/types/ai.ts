/**
 * AI 相关类型定义
 */

import type { SupportedLanguage } from '../services/prompts/utils'

// ==================== Provider 类型 ====================

/**
 * AI 提供商类型
 */
export type AIProviderType = 'gemini' | 'openai' | 'ollama' | '302.ai' | 'custom'

/**
 * AI 提供商配置
 */
export interface AIProviderConfig {
  provider: AIProviderType
  apiKey: string
  apiUrl?: string
  model?: string
  temperature?: number
  proxyUrl?: string
  proxyEnabled?: boolean
}

/**
 * AI 服务选项
 */
export interface AIServiceOptions {
  /** Token 使用回调 */
  onTokenUsage?: (tokens: number) => void
  /** 最大重试次数 */
  maxRetries?: number
  /** 基础重试延迟（毫秒） */
  baseRetryDelay?: number
}

// ==================== 提示词配置 ====================

/**
 * 提示词配置
 */
export interface PromptConfig {
  chapterSummary: {
    fiction: string
    nonFiction: string
  }
  mindmap: {
    chapter: string
    arrow: string
    combined: string
  }
  connectionAnalysis: string
  overallSummary: string
}

// ==================== 生成内容 ====================

/**
 * 生成内容请求
 */
export interface GenerateContentRequest {
  prompt: string
  systemPrompt?: string
  temperature?: number
  outputLanguage?: SupportedLanguage
}

/**
 * 生成内容响应
 */
export interface GenerateContentResponse {
  content: string
  tokenCount?: number
  finishReason?: string
}

// ==================== 错误类型 ====================

/**
 * 速率限制错误
 */
export interface RateLimitError extends Error {
  isRateLimit: boolean
  retryAfter?: number
  status?: number
  code?: string
}

// ==================== Provider 接口 ====================

/**
 * AI Provider 接口（策略模式）
 */
export interface AIProvider {
  readonly type: AIProviderType
  readonly name: string

  /**
   * 生成内容
   */
  generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse>

  /**
   * 测试连接
   */
  testConnection(): Promise<{ success: boolean; error?: string }>

  /**
   * 是否支持系统提示词
   */
  readonly supportsSystemPrompt: boolean

  /**
   * 是否支持流式输出
   */
  readonly supportsStreaming: boolean
}

/**
 * Provider 构造函数类型
 */
export type AIProviderConstructor = new (
  config: AIProviderConfig,
  options?: AIServiceOptions
) => AIProvider

// ==================== 思维导图 ====================

/**
 * 思维导图节点
 */
export interface MindMapNode {
  id: string
  topic: string
  children?: MindMapNode[]
  direction?: 'left' | 'right'
}

// ==================== 语言 ====================

/**
 * 语言指令提供者
 */
export type LanguageInstructionProvider = (language: SupportedLanguage) => string
