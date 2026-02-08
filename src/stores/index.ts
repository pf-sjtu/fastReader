// Store统一导出
export * from './types'

// 子store
export * from './ai-config'
export * from './processing'
export * from './webdav'
export * from './prompts'
export * from './core'

// 兼容壳store（保持向后兼容）
export {
  useConfigStore,
  // 原有便捷选择器
  useAIConfig,
  useTokenUsage,
  useProcessingOptions,
  useWebDAVConfig,
  useAIServiceOptions,
  usePromptConfig,
  usePromptVersionConfig,
  useCurrentPromptVersion
} from './configStore'
