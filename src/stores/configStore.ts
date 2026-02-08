// ConfigStore - 兼容壳
// 所有状态和方法都转发到新的子store，保持向后兼容
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
import type { SupportedLanguage } from '../services/prompts/utils'
import { ConfigExportService } from '../services/configExportService'

// 从子store导入内部函数
import { computeAIConfig } from './ai-config'
import { useAIConfigStore } from './ai-config'
import { useProcessingStore } from './processing'
import { useWebDAVStore } from './webdav'
import { usePromptStore } from './prompts'
import { useCoreStore } from './core'

// 重新导出类型
export type { PromptConfig, WebDAVConfig }
/** @deprecated 使用 AIProviderConfig 替代 */
export type { AIProviderConfig as AIConfig }

// 默认配置（用于重置）
const defaultAIProvider: AIProviderConfig = {
  provider: 'gemini',
  apiKey: '',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-1.5-flash',
  temperature: 0.7,
  proxyUrl: '',
  proxyEnabled: false,
  customFields: {}
}

const createDefaultAIConfigManager = (): AIConfigManager => ({
  providers: [defaultAIProvider],
  currentModelId: 1,
  addProvider: () => 1,
  updateProvider: () => {},
  deleteProvider: () => {},
  duplicateProvider: () => 1,
  setCurrentModelId: () => {},
  getActiveProvider: () => defaultAIProvider,
  getProviderByIndex: () => defaultAIProvider,
  createFromTemplate: () => 1,
  getAvailableTemplates: () => []
})

const defaultProcessingOptions: ProcessingOptions = {
  processingMode: 'mindmap',
  bookType: 'non-fiction',
  useSmartDetection: false,
  skipNonEssentialChapters: true,
  maxSubChapterDepth: 0,
  outputLanguage: 'en',
  chapterNamingMode: 'auto',
  enableNotification: true,
  chapterDetectionMode: 'normal',
  epubTocDepth: 1
}

const defaultWebDAVConfig: WebDAVConfig = {
  enabled: false,
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  appName: 'fastReader_by_PF',
  autoSync: false,
  syncPath: '/fastReader',
  browsePath: '/',
  lastSyncTime: null,
  connectionStatus: 'disconnected'
}

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
export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      // 聚合状态（初始值）
      aiConfigManager: createDefaultAIConfigManager(),
      aiConfig: defaultAIProvider,
      tokenUsage: 0,
      processingOptions: defaultProcessingOptions,
      webdavConfig: defaultWebDAVConfig,
      promptConfig: {} as PromptConfig,
      promptVersionConfig: {} as PromptVersionConfig,
      currentPromptVersion: 'v1',
      aiServiceOptions: { maxRetries: 3, baseRetryDelay: 60000 },

      // AI配置 - 向后兼容设置方法
      setAiProvider: (provider) => {
        useAIConfigStore.getState().setAiProvider(provider)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setApiKey: (apiKey) => {
        useAIConfigStore.getState().setApiKey(apiKey)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setApiUrl: (apiUrl) => {
        useAIConfigStore.getState().setApiUrl(apiUrl)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setModel: (model) => {
        useAIConfigStore.getState().setModel(model)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setTemperature: (temperature) => {
        useAIConfigStore.getState().setTemperature(temperature)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setProxyUrl: (proxyUrl) => {
        useAIConfigStore.getState().setProxyUrl(proxyUrl)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },
      setProxyEnabled: (enabled) => {
        useAIConfigStore.getState().setProxyEnabled(enabled)
        set({ aiConfig: useAIConfigStore.getState().aiConfig })
      },

      // AI服务商管理方法
      addAIProvider: (config) => {
        const result = useAIConfigStore.getState().addAIProvider(config)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
        return result
      },
      updateAIProvider: (index, config) => {
        useAIConfigStore.getState().updateAIProvider(index, config)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
      },
      deleteAIProvider: (index) => {
        useAIConfigStore.getState().deleteAIProvider(index)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
      },
      duplicateAIProvider: (index) => {
        const result = useAIConfigStore.getState().duplicateAIProvider(index)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
        return result
      },
      setCurrentModelId: (index) => {
        useAIConfigStore.getState().setCurrentModelId(index)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
      },
      getActiveAIProvider: () => {
        return useAIConfigStore.getState().getActiveAIProvider()
      },
      getAIProviderByIndex: (index) => {
        return useAIConfigStore.getState().getAIProviderByIndex(index)
      },
      createAIProviderFromTemplate: (template) => {
        const result = useAIConfigStore.getState().createAIProviderFromTemplate(template)
        set({
          aiConfigManager: useAIConfigStore.getState().aiConfigManager,
          aiConfig: useAIConfigStore.getState().aiConfig
        })
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
        set({ tokenUsage: useCoreStore.getState().tokenUsage })
      },
      resetTokenUsage: () => {
        useCoreStore.getState().resetTokenUsage()
        set({ tokenUsage: 0 })
      },

      // 处理选项
      setProcessingMode: (processingMode) => {
        useProcessingStore.getState().setProcessingMode(processingMode)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setBookType: (bookType) => {
        useProcessingStore.getState().setBookType(bookType)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setUseSmartDetection: (useSmartDetection) => {
        useProcessingStore.getState().setUseSmartDetection(useSmartDetection)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setSkipNonEssentialChapters: (skipNonEssentialChapters) => {
        useProcessingStore.getState().setSkipNonEssentialChapters(skipNonEssentialChapters)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setMaxSubChapterDepth: (maxSubChapterDepth) => {
        useProcessingStore.getState().setMaxSubChapterDepth(maxSubChapterDepth)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setOutputLanguage: (outputLanguage) => {
        useProcessingStore.getState().setOutputLanguage(outputLanguage)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setChapterNamingMode: (chapterNamingMode) => {
        useProcessingStore.getState().setChapterNamingMode(chapterNamingMode)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setEnableNotification: (enableNotification) => {
        useProcessingStore.getState().setEnableNotification(enableNotification)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setChapterDetectionMode: (chapterDetectionMode) => {
        useProcessingStore.getState().setChapterDetectionMode(chapterDetectionMode)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },
      setEpubTocDepth: (epubTocDepth) => {
        useProcessingStore.getState().setEpubTocDepth(epubTocDepth)
        set({ processingOptions: useProcessingStore.getState().processingOptions })
      },

      // WebDAV配置
      setWebDAVEnabled: (enabled) => {
        useWebDAVStore.getState().setWebDAVEnabled(enabled)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVServerUrl: (serverUrl) => {
        useWebDAVStore.getState().setWebDAVServerUrl(serverUrl)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVUsername: (username) => {
        useWebDAVStore.getState().setWebDAVUsername(username)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVPassword: (password) => {
        useWebDAVStore.getState().setWebDAVPassword(password)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVAppName: (appName) => {
        useWebDAVStore.getState().setWebDAVAppName(appName)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVAutoSync: (autoSync) => {
        useWebDAVStore.getState().setWebDAVAutoSync(autoSync)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVSyncPath: (syncPath) => {
        useWebDAVStore.getState().setWebDAVSyncPath(syncPath)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVBrowsePath: (browsePath) => {
        useWebDAVStore.getState().setWebDAVBrowsePath(browsePath)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      setWebDAVConnectionStatus: (connectionStatus) => {
        useWebDAVStore.getState().setWebDAVConnectionStatus(connectionStatus)
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      updateWebDAVLastSyncTime: () => {
        useWebDAVStore.getState().updateWebDAVLastSyncTime()
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },
      resetWebDAVConfig: () => {
        useWebDAVStore.getState().resetWebDAVConfig()
        set({ webdavConfig: useWebDAVStore.getState().webdavConfig })
      },

      // 提示词配置
      setCurrentPromptVersion: (version) => {
        usePromptStore.getState().setCurrentPromptVersion(version)
        set({
          currentPromptVersion: usePromptStore.getState().currentPromptVersion,
          promptConfig: usePromptStore.getState().promptConfig
        })
      },
      setChapterSummaryPrompt: (bookType, prompt) => {
        usePromptStore.getState().setChapterSummaryPrompt(bookType, prompt)
        set({ promptConfig: usePromptStore.getState().promptConfig })
      },
      setMindmapPrompt: (mindmapType, prompt) => {
        usePromptStore.getState().setMindmapPrompt(mindmapType, prompt)
        set({ promptConfig: usePromptStore.getState().promptConfig })
      },
      setConnectionAnalysisPrompt: (prompt) => {
        usePromptStore.getState().setConnectionAnalysisPrompt(prompt)
        set({ promptConfig: usePromptStore.getState().promptConfig })
      },
      setOverallSummaryPrompt: (prompt) => {
        usePromptStore.getState().setOverallSummaryPrompt(prompt)
        set({ promptConfig: usePromptStore.getState().promptConfig })
      },
      resetPromptsToDefault: () => {
        usePromptStore.getState().resetPromptsToDefault()
        set({
          promptConfig: usePromptStore.getState().promptConfig,
          promptVersionConfig: usePromptStore.getState().promptVersionConfig
        })
      },
      resetPromptsToDefaultForVersion: (version) => {
        usePromptStore.getState().resetPromptsToDefaultForVersion(version)
        set({
          promptConfig: usePromptStore.getState().promptConfig,
          promptVersionConfig: usePromptStore.getState().promptVersionConfig
        })
      },

      // AI服务选项
      setMaxRetries: (maxRetries) => {
        useCoreStore.getState().setMaxRetries(maxRetries)
        set({ aiServiceOptions: useCoreStore.getState().aiServiceOptions })
      },
      setBaseRetryDelay: (baseRetryDelay) => {
        useCoreStore.getState().setBaseRetryDelay(baseRetryDelay)
        set({ aiServiceOptions: useCoreStore.getState().aiServiceOptions })
      },

      // 配置导出导入功能
      exportConfig: () => {
        const state = getAggregatedState()
        return ConfigExportService.exportConfig(state as ConfigState)
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
            useAIConfigStore.setState({
              aiConfigManager: config.aiConfigManager,
              aiConfig: computeAIConfig(config.aiConfigManager)
            })
          }

          // 处理选项
          if (config.processingOptions) {
            useProcessingStore.setState({ processingOptions: config.processingOptions })
          }

          // WebDAV配置
          if (config.webdavConfig) {
            useWebDAVStore.setState({ webdavConfig: config.webdavConfig })
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

          // 更新兼容壳状态
          set(getAggregatedState())

          return { success: true }
        } catch (error) {
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

        set(getAggregatedState())
      }
    }),
    {
      name: 'ebook-mindmap-config', // 保持原有localStorage键名
      partialize: (state) => ({
        aiConfigManager: state.aiConfigManager,
        aiConfig: state.aiConfig,
        tokenUsage: state.tokenUsage,
        processingOptions: state.processingOptions,
        webdavConfig: state.webdavConfig,
        promptConfig: state.promptConfig,
        promptVersionConfig: state.promptVersionConfig,
        currentPromptVersion: state.currentPromptVersion,
        aiServiceOptions: state.aiServiceOptions
      })
    }
  )
)

// 导出便捷的选择器（保持与原有API完全一致）
export const useAIConfig = () => useConfigStore((state) => state.aiConfig)
export const useTokenUsage = () => useConfigStore((state) => state.tokenUsage)
export const useProcessingOptions = () => useConfigStore((state) => state.processingOptions)
export const useWebDAVConfig = () => useConfigStore((state) => state.webdavConfig)
export const useAIServiceOptions = () => useConfigStore((state) => state.aiServiceOptions)
export const usePromptConfig = () => useConfigStore((state) => state.promptConfig)
export const usePromptVersionConfig = () => useConfigStore((state) => state.promptVersionConfig)
export const useCurrentPromptVersion = () => useConfigStore((state) => state.currentPromptVersion)
