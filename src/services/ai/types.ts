/**
 * AI Provider 类型定义
 * 策略模式接口
 * @deprecated 请从 @/types 导入
 */

import type { AIProvider, GenerateContentRequest, GenerateContentResponse, StructuredFormat } from '../../types/ai'

// 从统一类型定义重新导出，保持向后兼容
export type {
  AIProviderType,
  AIProviderConfig,
  AIServiceOptions,
  PromptConfig,
  GenerateContentRequest,
  GenerateContentResponse,
  RateLimitError,
  AIProvider,
  AIProviderConstructor,
  MindMapNode,
  LanguageInstructionProvider,
} from '../../types/ai'

// 章节类型（简化版，用于 AI 处理）
export interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
}

/** AI 调用选项（C1）：取消信号一路传到 provider 的 fetch 与重试 sleep */
export interface AICallOptions {
  signal?: AbortSignal
  /** 输出因长度上限被截断时回调（AIService 返回字符串，无法挂字段） */
  onTruncated?: (info: { finishReason?: string }) => void
  /** 章节总结重写：上一次输出的问题说明，追加到提示词末尾（只用于定向重写，最多一次） */
  rewriteHint?: string
  /** 全书实体表（各章旁路合并）：书级步骤要求模型沿用其中的规范名与别名 */
  entityTable?: string
  /** 格式化请求（输出必须是 JSON）：provider 按上游最新的结构化输出标准发送 */
  format?: StructuredFormat
}

/** provider 返回：在通用响应上补充截断标记 */
export interface AIGenerateResult extends GenerateContentResponse {
  /** finishReason 为 length / MAX_TOKENS 时为 true */
  truncated?: boolean
}

/** 支持取消的 provider（本目录所有实现均满足） */
export interface CancellableAIProvider extends AIProvider {
  generateContent(request: GenerateContentRequest, opts?: AICallOptions): Promise<AIGenerateResult>
}
