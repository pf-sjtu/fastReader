// Store统一导出
export * from './types'

// 子store
export * from './ai-config'
export * from './processing'
export * from './webdav'
export * from './prompts'
export * from './usage'
export * from './processingHistory'
export * from './aiMigration'

// 兼容壳store（保持向后兼容）
export {
  useConfigStore,
  // 原有便捷选择器
  useAIConfig,
  useTokenUsage,
  useTotalCostUSD,
  useProcessingOptions,
  useWebDAVConfig,
  useAIServiceOptions,
  usePromptConfig,
  usePromptOverrides,
  useExchangeRate,
} from './configStore'
