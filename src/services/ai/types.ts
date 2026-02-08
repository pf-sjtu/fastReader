/**
 * AI Provider 类型定义
 * 策略模式接口
 * @deprecated 请从 @/types 导入
 */

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
