// ConfigStore - 兼容壳
// 所有状态和方法都转发到子store，保持向后兼容。
// 单一事实来源：数据只由子store持久化；本壳不持久化，数据字段通过订阅子store派生。
import { create } from 'zustand'
import type {
  PromptConfig,
  PromptVersionConfig,
  AIProviderConfig,
  AIConfigManager,
  AIConfig,
  ProcessingOptions,
  WebDAVConfig,
  AIServiceOptions
} from './types'
import { migrateLegacyConfig } from './legacyMigration'
import type { SupportedLanguage } from '../services/prompts/utils'
import { ConfigExportService } from '../services/configExportService'
import { logger } from '../lib/logger'

// 从子store导入内部函数
import { mergeAIConfigManager } from './ai-config'
import { useAIConfigStore } from './ai-config'
import { useProcessingStore } from './processing'
import { useWebDAVStore } from './webdav'
import { usePromptStore } from './prompts'
import { useCoreStore } from './core'

// 重新导出类型
export type { PromptConfig, WebDAVConfig }
/** @deprecated 使用 AIProviderConfig 替代 */
export type { AIProviderConfig as AIConfig }

// 配置store状态接口（保持与原接口完全一致）
export interface ConfigState {
  // AI配置管理
  aiConfigManager: AIConfigManager
  aiConfig: AIConfig
  setAiProvider: (provider: 'gemini' | 'openai' | 'ollama' | '302.ai') => void
  setApiKey: (apiKey: string) => void
  setApiUrl: (apiUrl: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
  setProxyUrl: (proxyUrl: string) => void
  setProxyEnabled: (enabled: boolean) => void

  // AI服务商管理方法
  addAIProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateAIProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteAIProvider: (index: number) => void
  duplicateAIProvider: (index: number) => number
  setCurrentModelId: (index: number) => void
  getActiveAIProvider: () => AIProviderConfig | undefined
  getAIProviderByIndex: (index: number) => AIProviderConfig | undefined
  createAIProviderFromTemplate: (template: 'gemini' | 'openai' | 'ollama' | '302.ai') => number
  getAvailableAITemplates: () => Array<{ id: string; name: string; description: string }>

  // AI配置管理器方法（直接访问）
  addProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteProvider: (index: number) => void
  duplicateProvider: (index: number) => number
  getProviderByIndex: (index: number) => AIProviderConfig | undefined

  // Token使用量追踪
  tokenUsage: number
  addTokenUsage: (tokens: number) => void
  resetTokenUsage: () => void

  // 处理选项
  processingOptions: ProcessingOptions
  setProcessingMode: (mode: 'summary' | 'mindmap' | 'combined-mindmap') => void
  setBookType: (type: 'fiction' | 'non-fiction') => void
  setUseSmartDetection: (enabled: boolean) => void
  setSkipNonEssentialChapters: (enabled: boolean) => void
  setMaxSubChapterDepth: (depth: number) => void
  setOutputLanguage: (language: SupportedLanguage) => void
  setChapterNamingMode: (mode: 'auto' | 'numbered') => void
  setEnableNotification: (enabled: boolean) => void
  setChapterDetectionMode: (mode: 'normal' | 'smart' | 'epub-toc') => void
  setEpubTocDepth: (depth: number) => void
  setChapterConcurrency: (concurrency: number) => void

  // WebDAV配置
  webdavConfig: WebDAVConfig
  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  setWebDAVPassword: (password: string) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void
  setWebDAVBrowsePath: (browsePath: string) => void
  setWebDAVConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void

  // 提示词配置
  promptConfig: PromptConfig
  promptVersionConfig: PromptVersionConfig
  currentPromptVersion: 'v1' | 'v2'
  setCurrentPromptVersion: (version: 'v1' | 'v2') => void
  setChapterSummaryPrompt: (bookType: 'fiction' | 'non-fiction', prompt: string) => void
  setMindmapPrompt: (mindmapType: 'chapter' | 'arrow' | 'combined', prompt: string) => void
  setConnectionAnalysisPrompt: (prompt: string) => void
  setOverallSummaryPrompt: (prompt: string) => void
  resetPromptsToDefault: () => void
  resetPromptsToDefaultForVersion: (version: 'v1' | 'v2') => void

  // AI服务选项
  aiServiceOptions: AIServiceOptions
  setMaxRetries: (maxRetries: number) => void
  setBaseRetryDelay: (baseRetryDelay: number) => void

  // 配置导出导入功能
  exportConfig: () => string
  importConfig: (yamlContent: string) => { success: boolean; error?: string }
  resetAllConfig: () => void
}

// 拆分前的老用户数据迁移到子store（须在壳读取子store初始值之前执行）
migrateLegacyConfig()

// 辅助函数：从各子store聚合状态
const getAggregatedState = () => {
  // 使用getState()获取当前状态（非hooks方式）
  const aiState = useAIConfigStore.getState()
  const processingState = useProcessingStore.getState()
  const webdavState = useWebDAVStore.getState()
  const promptState = usePromptStore.getState()
  const coreState = useCoreStore.getState()

  return {
    aiConfigManager: aiState.aiConfigManager,
    aiConfig: aiState.aiConfig,
    tokenUsage: coreState.tokenUsage,
    processingOptions: processingState.processingOptions,
    webdavConfig: webdavState.webdavConfig,
    promptConfig: promptState.promptConfig,
    promptVersionConfig: promptState.promptVersionConfig,
    currentPromptVersion: promptState.currentPromptVersion,
    aiServiceOptions: coreState.aiServiceOptions
  }
}

// 兼容壳store
// 不持久化：数据字段是子store的镜像，由文件末尾的订阅保持同步
export const useConfigStore = create<ConfigState>()(
  (_set, get) => ({
    // 聚合状态（初始值取自已水合的子store）
    ...getAggregatedState(),

    // AI配置 - 向后兼容设置方法
    setAiProvider: (provider) => {
      useAIConfigStore.getState().setAiProvider(provider)
    },
    setApiKey: (apiKey) => {
      useAIConfigStore.getState().setApiKey(apiKey)
    },
    setApiUrl: (apiUrl) => {
      useAIConfigStore.getState().setApiUrl(apiUrl)
    },
    setModel: (model) => {
      useAIConfigStore.getState().setModel(model)
    },
    setTemperature: (temperature) => {
      useAIConfigStore.getState().setTemperature(temperature)
    },
    setProxyUrl: (proxyUrl) => {
      useAIConfigStore.getState().setProxyUrl(proxyUrl)
    },
    setProxyEnabled: (enabled) => {
      useAIConfigStore.getState().setProxyEnabled(enabled)
    },

    // AI服务商管理方法
    addAIProvider: (config) => {
      const result = useAIConfigStore.getState().addAIProvider(config)
      return result
    },
    updateAIProvider: (index, config) => {
      useAIConfigStore.getState().updateAIProvider(index, config)
    },
    deleteAIProvider: (index) => {
      useAIConfigStore.getState().deleteAIProvider(index)
    },
    duplicateAIProvider: (index) => {
      const result = useAIConfigStore.getState().duplicateAIProvider(index)
      return result
    },
    setCurrentModelId: (index) => {
      useAIConfigStore.getState().setCurrentModelId(index)
    },
    getActiveAIProvider: () => {
      return useAIConfigStore.getState().getActiveAIProvider()
    },
    getAIProviderByIndex: (index) => {
      return useAIConfigStore.getState().getAIProviderByIndex(index)
    },
    createAIProviderFromTemplate: (template) => {
      const result = useAIConfigStore.getState().createAIProviderFromTemplate(template)
      return result
    },
    getAvailableAITemplates: () => {
      return useAIConfigStore.getState().getAvailableAITemplates()
    },

    // AI配置管理器方法（直接访问）
    addProvider: (config) => {
      return get().addAIProvider(config)
    },
    updateProvider: (index, config) => {
      get().updateAIProvider(index, config)
    },
    deleteProvider: (index) => {
      get().deleteAIProvider(index)
    },
    duplicateProvider: (index) => {
      return get().duplicateAIProvider(index)
    },
    getProviderByIndex: (index) => {
      return get().getAIProviderByIndex(index)
    },

    // Token使用量追踪
    addTokenUsage: (tokens) => {
      useCoreStore.getState().addTokenUsage(tokens)
    },
    resetTokenUsage: () => {
      useCoreStore.getState().resetTokenUsage()
    },

    // 处理选项
    setProcessingMode: (processingMode) => {
      useProcessingStore.getState().setProcessingMode(processingMode)
    },
    setBookType: (bookType) => {
      useProcessingStore.getState().setBookType(bookType)
    },
    setUseSmartDetection: (useSmartDetection) => {
      useProcessingStore.getState().setUseSmartDetection(useSmartDetection)
    },
    setSkipNonEssentialChapters: (skipNonEssentialChapters) => {
      useProcessingStore.getState().setSkipNonEssentialChapters(skipNonEssentialChapters)
    },
    setMaxSubChapterDepth: (maxSubChapterDepth) => {
      useProcessingStore.getState().setMaxSubChapterDepth(maxSubChapterDepth)
    },
    setOutputLanguage: (outputLanguage) => {
      useProcessingStore.getState().setOutputLanguage(outputLanguage)
    },
    setChapterNamingMode: (chapterNamingMode) => {
      useProcessingStore.getState().setChapterNamingMode(chapterNamingMode)
    },
    setEnableNotification: (enableNotification) => {
      useProcessingStore.getState().setEnableNotification(enableNotification)
    },
    setChapterDetectionMode: (chapterDetectionMode) => {
      useProcessingStore.getState().setChapterDetectionMode(chapterDetectionMode)
    },
    setEpubTocDepth: (epubTocDepth) => {
      useProcessingStore.getState().setEpubTocDepth(epubTocDepth)
    },
    setChapterConcurrency: (chapterConcurrency) => {
      useProcessingStore.getState().setChapterConcurrency(chapterConcurrency)
    },

    // WebDAV配置
    setWebDAVEnabled: (enabled) => {
      useWebDAVStore.getState().setWebDAVEnabled(enabled)
    },
    setWebDAVServerUrl: (serverUrl) => {
      useWebDAVStore.getState().setWebDAVServerUrl(serverUrl)
    },
    setWebDAVUsername: (username) => {
      useWebDAVStore.getState().setWebDAVUsername(username)
    },
    setWebDAVPassword: (password) => {
      useWebDAVStore.getState().setWebDAVPassword(password)
    },
    setWebDAVAppName: (appName) => {
      useWebDAVStore.getState().setWebDAVAppName(appName)
    },
    setWebDAVAutoSync: (autoSync) => {
      useWebDAVStore.getState().setWebDAVAutoSync(autoSync)
    },
    setWebDAVSyncPath: (syncPath) => {
      useWebDAVStore.getState().setWebDAVSyncPath(syncPath)
    },
    setWebDAVBrowsePath: (browsePath) => {
      useWebDAVStore.getState().setWebDAVBrowsePath(browsePath)
    },
    setWebDAVConnectionStatus: (connectionStatus) => {
      useWebDAVStore.getState().setWebDAVConnectionStatus(connectionStatus)
    },
    updateWebDAVLastSyncTime: () => {
      useWebDAVStore.getState().updateWebDAVLastSyncTime()
    },
    resetWebDAVConfig: () => {
      useWebDAVStore.getState().resetWebDAVConfig()
    },

    // 提示词配置
    setCurrentPromptVersion: (version) => {
      usePromptStore.getState().setCurrentPromptVersion(version)
    },
    setChapterSummaryPrompt: (bookType, prompt) => {
      usePromptStore.getState().setChapterSummaryPrompt(bookType, prompt)
    },
    setMindmapPrompt: (mindmapType, prompt) => {
      usePromptStore.getState().setMindmapPrompt(mindmapType, prompt)
    },
    setConnectionAnalysisPrompt: (prompt) => {
      usePromptStore.getState().setConnectionAnalysisPrompt(prompt)
    },
    setOverallSummaryPrompt: (prompt) => {
      usePromptStore.getState().setOverallSummaryPrompt(prompt)
    },
    resetPromptsToDefault: () => {
      usePromptStore.getState().resetPromptsToDefault()
    },
    resetPromptsToDefaultForVersion: (version) => {
      usePromptStore.getState().resetPromptsToDefaultForVersion(version)
    },

    // AI服务选项
    setMaxRetries: (maxRetries) => {
      useCoreStore.getState().setMaxRetries(maxRetries)
    },
    setBaseRetryDelay: (baseRetryDelay) => {
      useCoreStore.getState().setBaseRetryDelay(baseRetryDelay)
    },

    // 配置导出导入功能
    exportConfig: () => {
      const state = getAggregatedState()
      return ConfigExportService.exportConfig(state)
    },

    importConfig: (yamlContent) => {
      try {
        const importedConfig = ConfigExportService.importConfig(yamlContent)

        const validation = ConfigExportService.validateConfig(importedConfig)
        if (!validation.isValid) {
          return {
            success: false,
            error: `配置验证失败: ${validation.errors.join(', ')}`
          }
        }

        // 应用导入的配置到各子store
        const config = importedConfig.config

        // AI配置
        if (config.aiConfigManager) {
          useAIConfigStore.setState((s) => mergeAIConfigManager(s, config.aiConfigManager))
        }

        // 处理选项
        if (config.processingOptions) {
          useProcessingStore.getState().updateProcessingOptions(config.processingOptions)
        }

        // WebDAV配置
        if (config.webdavConfig) {
          useWebDAVStore.getState().updateWebDAVConfig(config.webdavConfig)
        }

        // 提示词配置
        if (config.promptVersionConfig && config.currentPromptVersion) {
          const promptConfig = config.promptVersionConfig[config.currentPromptVersion]
          usePromptStore.setState({
            promptConfig,
            promptVersionConfig: config.promptVersionConfig,
            currentPromptVersion: config.currentPromptVersion
          })
        }

        // Token使用量
        if (typeof config.tokenUsage === 'number') {
          useCoreStore.setState({ tokenUsage: config.tokenUsage })
        }

        return { success: true }
      } catch (error) {
        logger.error('[ConfigStore] 导入配置失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '导入配置时发生未知错误'
        }
      }
    },

    resetAllConfig: () => {
      useAIConfigStore.getState().resetAIConfig()
      useProcessingStore.getState().resetProcessingOptions()
      useWebDAVStore.getState().resetWebDAVConfig()
      usePromptStore.setState({
        currentPromptVersion: 'v1',
        promptConfig: usePromptStore.getState().promptVersionConfig.v1
      })
      useCoreStore.getState().resetCoreState()
    }
  })
)

// 子store → 兼容壳 单向同步（任何途径改子store，壳都跟着变）
useAIConfigStore.subscribe((s) =>
  useConfigStore.setState({ aiConfigManager: s.aiConfigManager, aiConfig: s.aiConfig })
)
useProcessingStore.subscribe((s) => useConfigStore.setState({ processingOptions: s.processingOptions }))
useWebDAVStore.subscribe((s) => useConfigStore.setState({ webdavConfig: s.webdavConfig }))
usePromptStore.subscribe((s) =>
  useConfigStore.setState({
    promptConfig: s.promptConfig,
    promptVersionConfig: s.promptVersionConfig,
    currentPromptVersion: s.currentPromptVersion
  })
)
useCoreStore.subscribe((s) =>
  useConfigStore.setState({ tokenUsage: s.tokenUsage, aiServiceOptions: s.aiServiceOptions })
)

// 导出便捷的选择器（保持与原有API完全一致）
export const useAIConfig = () => useConfigStore((state) => state.aiConfig)
// 细粒度订阅：只在 tokenUsage 变化时重渲染（直接订阅 core 子store）
export const useTokenUsage = () => useCoreStore((state) => state.tokenUsage)
export const useProcessingOptions = () => useConfigStore((state) => state.processingOptions)
export const useWebDAVConfig = () => useConfigStore((state) => state.webdavConfig)
export const useAIServiceOptions = () => useConfigStore((state) => state.aiServiceOptions)
export const usePromptConfig = () => useConfigStore((state) => state.promptConfig)
export const usePromptVersionConfig = () => useConfigStore((state) => state.promptVersionConfig)
export const useCurrentPromptVersion = () => useConfigStore((state) => state.currentPromptVersion)
