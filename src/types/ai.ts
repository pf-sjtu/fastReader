/**
 * AI 相关类型定义
 */

import type { SupportedLanguage } from '../services/prompts/utils'

// ==================== Provider 类型 ====================

/**
 * AI 提供商协议类型
 *
 * - openai：OpenAI 兼容 `/chat/completions` 与 `/models`
 * - gemini：Google Generative Language REST
 * - ollama：本地 Ollama（浏览器直连，不经代理）
 * - anthropic：Anthropic Messages（`/messages`；Kiro 等只提供该协议的网关）
 * - 302.ai / custom：历史值，等价于 openai 兼容
 */
export type AIProviderType = 'gemini' | 'openai' | 'ollama' | 'anthropic' | '302.ai' | 'custom'

/** 新的协议枚举（服务商配置使用；302.ai/custom 归一化为 openai） */
export type AIProtocol = 'openai' | 'gemini' | 'ollama' | 'anthropic'

/**
 * 模型元数据（来自 models.dev，可缺失）
 *
 * 价格单位为 USD / 100 万 tokens。
 */
export interface ProviderModelMeta {
  context?: number
  output?: number
  inputCost?: number
  outputCost?: number
  reasoning?: boolean
  temperature?: boolean
  /** 支持 OpenAI 风格的 reasoning_effort 参数（来源：OpenRouter supported_parameters） */
  reasoningEffort?: boolean
}

/**
 * 服务商下的单个模型
 */
export interface ProviderModel {
  id: string
  label?: string
  enabled: boolean
  /** auto = 从服务商 /models 拉取；manual = 用户手填 */
  source: 'auto' | 'manual'
  /** 覆盖全局默认温度 */
  temperature?: number
  /** 覆盖全局默认思考强度 */
  reasoningEffort?: ReasoningEffort
  meta?: ProviderModelMeta
}

/**
 * 秘密字段的服务端视图：客户端只知道「是否已配置」，永远拿不到明文
 */
export interface SecretRef {
  hasSecret: boolean
}

/**
 * 服务商条目：一条配置 = 一个 baseUrl + 凭据 + 多个模型
 */
export interface ProviderEntry {
  id: string
  name: string
  type: AIProtocol
  baseUrl: string
  apiKey?: SecretRef
  /** models.dev 中的 provider id（用于元数据匹配与预设来源） */
  catalogId?: string
  models: ProviderModel[]
  /** 上次从服务商拉取模型列表的时间 */
  modelsFetchedAt?: string
  /**
   * 自动同步时的模型过滤（前缀或 /正则/）。聚合网关常有几百个模型，只想要其中一类时用它，
   * 例如 navira 只要转接商汤的模型：`{ include: ['sensenova/'] }`
   */
  modelFilter?: { include?: string[]; exclude?: string[] }
}

/**
 * 思考强度：
 * - auto：不发任何参数，由服务商默认决定（兼容性最好）
 * - off / low / medium / high：OpenAI 兼容端点映射为 reasoning_effort（off→minimal），
 *   Anthropic 映射为 thinking.budget_tokens，Gemini 映射为 thinkingBudget
 * 服务商不支持时自动去掉参数重试一次，不会因此失败。
 */
export type ReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high'
export const REASONING_EFFORTS: ReasoningEffort[] = ['auto', 'off', 'low', 'medium', 'high']

/** AI 共享状态：服务商列表 + 当前模型 */
export interface AIState {
  providers: ProviderEntry[]
  active: { providerId: string; modelId: string }
  defaultTemperature: number
  /** 全局默认思考强度；缺省 auto */
  reasoningEffort?: ReasoningEffort
}

/**
 * AI 运行时配置视图（由 AIState 派生，不含明文凭据）
 *
 * 供 provider 实现与处理链路使用；`providerId` 用于让同源代理在服务端取凭据。
 */
export interface AIProviderConfig {
  provider: AIProviderType
  /** 服务商 id：请求代理时用于在服务端定位 baseUrl 与凭据 */
  providerId?: string
  /**
   * 当前服务商是否已具备可用凭据（服务端已保存密钥，或 Ollama 这类无需密钥的协议）。
   * 运行时视图不含明文 apiKey——UI 判断「是否已配置」必须看这个字段，不能看 apiKey。
   */
  hasCredentials?: boolean
  /** 仅在直连模式（Ollama）或测试中使用 */
  apiKey?: string
  apiUrl: string
  model: string
  temperature: number
  /** 本次运行生效的思考强度（模型级覆盖 > 全局默认 > auto） */
  reasoningEffort?: ReasoningEffort
  proxyUrl?: string
  proxyEnabled?: boolean
  /** 历史字段：旧配置的附加项，导入时忽略 */
  customFields?: Record<string, unknown>
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

export interface RateLimitError extends Error {
  isRateLimit: boolean
  retryAfter?: number
  status?: number
  code?: string
}

/** AI 提供商接口 */
export interface AIProvider {
  readonly type: AIProviderType
  readonly name: string
  readonly supportsSystemPrompt: boolean
  readonly supportsStreaming: boolean
  generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse>
  testConnection(): Promise<{ success: boolean; error?: string }>
}

export type AIProviderConstructor = new (
  config: AIProviderConfig,
  options?: AIServiceOptions
) => AIProvider

// ==================== 语言 ====================

/**
 * 语言指令提供者
 */
export type LanguageInstructionProvider = (language: SupportedLanguage) => string

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
