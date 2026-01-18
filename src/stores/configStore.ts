import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SupportedLanguage } from '../services/prompts/utils'
import { DEFAULT_PROMPT_CONFIG, DEFAULT_PROMPT_CONFIG_V2 } from '../services/prompts/templates'
import { ConfigExportService } from '../services/configExportService'

// 提示词配置接口
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

// 提示词版本配置接口
interface PromptVersionConfig {
  v1: PromptConfig
  v2: PromptConfig
}

// 单个AI服务商配置接口 (简化版)
interface AIProviderConfig {
  provider: 'gemini' | 'openai' | 'ollama' | '302.ai' | 'custom' // 服务商类型
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  proxyUrl?: string // 代理服务器地址
  proxyEnabled?: boolean // 是否启用代理
  customFields?: Record<string, unknown> // 自定义字段，用于不同服务商的特殊配置
}

// AI配置管理接口 (简化版)
interface AIConfigManager {
  providers: AIProviderConfig[] // 所有AI服务商配置
  currentModelId: number // 当前激活的服务商序号 (1-based)

  // 管理服务商配置
  addProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteProvider: (index: number, config?: never) => void
  duplicateProvider: (index: number) => number
  setCurrentModelId: (index: number) => void


  // 获取当前配置
  getActiveProvider: () => AIProviderConfig | undefined
  getProviderByIndex: (index: number) => AIProviderConfig | undefined

  // 模板管理
  createFromTemplate: (template: 'gemini' | 'openai' | 'ollama' | '302.ai') => number
  getAvailableTemplates: () => Array<{ id: string; name: string; description: string }>
}

// 兼容性接口（保持向后兼容）
interface AIConfig {
  provider: 'gemini' | 'openai' | 'ollama' | '302.ai'
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  proxyUrl?: string // 代理服务器地址
  proxyEnabled?: boolean // 是否启用代理
}

// 处理选项接口
interface ProcessingOptions {
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  bookType: 'fiction' | 'non-fiction'
  useSmartDetection: boolean
  skipNonEssentialChapters: boolean
  maxSubChapterDepth: number
  outputLanguage: SupportedLanguage
  chapterNamingMode: 'auto' | 'numbered' // 章节命名模式：auto-自动识别，numbered-第x章格式
  enableNotification: boolean // 是否启用任务完成通知
  chapterDetectionMode: 'normal' | 'smart' | 'epub-toc' // 章节识别模式：normal-普通模式，smart-智能检测，epub-toc-epub目录模式
  epubTocDepth: number // epub目录深度，只在使用epub-toc模式时有效
}

// WebDAV配置接口
export interface WebDAVConfig {
  enabled: boolean // 是否启用WebDAV
  serverUrl: string // WebDAV服务器地址
  username: string // 用户名
  password: string // 密码
  appName: string // 应用名称
  autoSync: boolean // 是否自动同步
  syncPath: string // 同步路径（默认为/fastReader）
  browsePath: string // 浏览路径（默认为/）
  lastSyncTime: string | null // 最后同步时间
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' // 连接状态
}



// AI服务选项接口
interface AIServiceOptions {
  maxRetries?: number // 最大重试次数，默认3次
  baseRetryDelay?: number // 基础重试延迟时间（毫秒），默认60s
}

// 配置store状态接口
export interface ConfigState {
  // AI配置管理
  aiConfigManager: AIConfigManager
  
  // 向后兼容的AI配置（从当前激活的服务商获取）
  aiConfig: AIConfig
  setAiProvider: (provider: 'gemini' | 'openai' | 'ollama' | '302.ai') => void
  setApiKey: (apiKey: string) => void
  setApiUrl: (apiUrl: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
  setProxyUrl: (proxyUrl: string) => void
  setProxyEnabled: (enabled: boolean) => void
  
  // 新的AI服务商管理方法
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

// AI服务商模板配置 (简化版)
const aiProviderTemplates: Record<string, AIProviderConfig & { name: string; description: string }> = {
  gemini: {
    name: 'Gemini',
    provider: 'gemini' as const,
    apiKey: '',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-1.5-flash',
    temperature: 0.7,
    proxyUrl: '',
    proxyEnabled: false,
    customFields: {},
    description: 'Google的生成式AI服务，支持多模态输入'
  },
  openai: {
    name: 'OpenAI',
    provider: 'openai' as const,
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    proxyUrl: '',
    proxyEnabled: false,
    customFields: {},
    description: 'OpenAI的GPT系列模型'
  },
  ollama: {
    name: 'Ollama',
    provider: 'ollama' as const,
    apiKey: '',
    apiUrl: 'http://localhost:11434/v1',
    model: 'llama2',
    temperature: 0.7,
    proxyUrl: '',
    proxyEnabled: false,
    customFields: {},
    description: '本地部署的Ollama服务'
  },
  '302.ai': {
    name: '302.AI',
    provider: '302.ai' as const,
    apiKey: '',
    apiUrl: 'https://api.302.ai/v1',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    proxyUrl: '',
    proxyEnabled: false,
    customFields: {},
    description: '302.AI提供的OpenAI兼容接口'
  }
}

// 默认配置

const defaultAIConfig: AIConfig = {
  provider: 'gemini',
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gemini-1.5-flash',
  temperature: 0.7,
  proxyUrl: '',
  proxyEnabled: false
}

// 默认AI配置管理器 (简化版)
const createDefaultAIConfigManager = (): AIConfigManager => {
  const defaultProvider: AIProviderConfig = {
    provider: 'gemini',
    apiKey: '',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-1.5-flash',
    temperature: 0.7,
    proxyUrl: '',
    proxyEnabled: false,
    customFields: {}
  }

  return {
    providers: [defaultProvider],
    currentModelId: 1,

    addProvider: () => {
      return 1
    },

    updateProvider: () => {
      // 这个方法会在store中被重写
    },

    deleteProvider: () => {
      // 这个方法会在store中被重写
    },

    duplicateProvider: () => {
      return 1
    },

    setCurrentModelId: () => {
      // 这个方法会在store中被重写
    },

    getActiveProvider: () => {
      return defaultProvider
    },

    getProviderByIndex: () => {
      return defaultProvider
    },

    createFromTemplate: () => {
      return 1
    },

    getAvailableTemplates: () => {
      return Object.entries(aiProviderTemplates).map(([id, template]) => ({
        id,
        name: template.name,
        description: template.description
      }))
    }
  }
}

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
  connectionStatus: 'disconnected',


}

const defaultPromptConfig: PromptConfig = DEFAULT_PROMPT_CONFIG
const defaultPromptVersionConfig: PromptVersionConfig = {
  v1: DEFAULT_PROMPT_CONFIG,
  v2: DEFAULT_PROMPT_CONFIG_V2
}

const defaultAIServiceOptions: AIServiceOptions = {
  maxRetries: 3,
  baseRetryDelay: 60000 // 60秒
}

// 计算aiConfig的辅助函数 (简化版 - 使用序号)
const computeAIConfig = (aiConfigManager: AIConfigManager): AIConfig => {
  const index = aiConfigManager.currentModelId - 1
  const activeProvider = aiConfigManager.providers[index]
  if (!activeProvider) {
    return defaultAIConfig
  }

  return {
    provider: activeProvider.provider as 'gemini' | 'openai' | 'ollama' | '302.ai',
    apiKey: activeProvider.apiKey,
    apiUrl: activeProvider.apiUrl,
    model: activeProvider.model,
    temperature: activeProvider.temperature,
    proxyUrl: activeProvider.proxyUrl || '',
    proxyEnabled: activeProvider.proxyEnabled || false
  }
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => {
      // 初始化aiConfigManager
      const initialAIConfigManager = {
        ...createDefaultAIConfigManager()
      }


      return {
        // AI配置管理
        aiConfigManager: initialAIConfigManager,
        
        // 向后兼容的AI配置（从当前激活的服务商获取）
        aiConfig: computeAIConfig(initialAIConfigManager),
        
        // Token使用量追踪
        tokenUsage: 0,
        addTokenUsage: (tokens) => set((state) => ({
          tokenUsage: state.tokenUsage + tokens
        })),
        resetTokenUsage: () => set(() => ({
          tokenUsage: 0
        })),
      
        // 向后兼容的设置方法（更新当前激活的提供商）
        setAiProvider: (provider) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { provider })
          }
        },
        setApiKey: (apiKey) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { apiKey })
          }
        },
        setApiUrl: (apiUrl) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { apiUrl })
          }
        },
        setModel: (model) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { model })
          }
        },
        setTemperature: (temperature) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { temperature })
          }
        },
        setProxyUrl: (proxyUrl) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { proxyUrl })
          }
        },
        setProxyEnabled: (enabled) => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            state.updateAIProvider(index, { proxyEnabled: enabled })
          }
        },
        
        // 新的AI服务商管理方法 (简化版 - 使用序号)
        addAIProvider: (config) => {
          const newProvider: AIProviderConfig = {
            ...config
          }

          let newIndex = 1
          set((state) => {
            newIndex = state.aiConfigManager.providers.length + 1 // 1-based index
            const newAIConfigManager = {
              ...state.aiConfigManager,
              providers: [...state.aiConfigManager.providers, newProvider],
              currentModelId: newIndex
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })

          return newIndex
        },


        updateAIProvider: (index, config) => {
          set((state) => {
            const providerIndex = index - 1 // Convert to 0-based
            if (providerIndex < 0 || providerIndex >= state.aiConfigManager.providers.length) {
              return state
            }
            const newProviders = [...state.aiConfigManager.providers]
            newProviders[providerIndex] = { ...newProviders[providerIndex], ...config }

            const newAIConfigManager = {
              ...state.aiConfigManager,
              providers: newProviders
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })
        },

        deleteAIProvider: (index) => {
          set((state) => {
            const providerIndex = index - 1 // Convert to 0-based
            if (providerIndex < 0 || providerIndex >= state.aiConfigManager.providers.length) {
              return state
            }

            const newProviders = state.aiConfigManager.providers.filter((_, i) => i !== providerIndex)

            // Adjust currentModelId
            let newCurrentModelId = state.aiConfigManager.currentModelId
            if (state.aiConfigManager.currentModelId === index) {
              // Deleted the active provider
              newCurrentModelId = newProviders.length > 0 ? Math.min(index, newProviders.length) : 1
            } else if (state.aiConfigManager.currentModelId > index) {
              // Active provider was after the deleted one
              newCurrentModelId = state.aiConfigManager.currentModelId - 1
            }

            const newAIConfigManager = {
              ...state.aiConfigManager,
              providers: newProviders,
              currentModelId: newCurrentModelId
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })
        },

        duplicateAIProvider: (index) => {
          const state = get()
          const providerIndex = index - 1
          if (providerIndex < 0 || providerIndex >= state.aiConfigManager.providers.length) {
            return -1
          }

          const original = state.aiConfigManager.providers[providerIndex]
          const duplicated: AIProviderConfig = { ...original }

          set((prevState) => {
            const newIndex = prevState.aiConfigManager.providers.length + 1
            const newAIConfigManager = {
              ...prevState.aiConfigManager,
              providers: [...prevState.aiConfigManager.providers, duplicated],
              currentModelId: newIndex
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })

          return state.aiConfigManager.providers.length
        },

        setCurrentModelId: (index) => {
          set((state) => {
            if (index < 1 || index > state.aiConfigManager.providers.length) {
              return state
            }
            const newAIConfigManager = {
              ...state.aiConfigManager,
              currentModelId: index
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })
        },

        getActiveAIProvider: () => {
          const state = get()
          const index = state.aiConfigManager.currentModelId - 1
          if (index >= 0 && index < state.aiConfigManager.providers.length) {
            return state.aiConfigManager.providers[index]
          }
          return undefined
        },

        getAIProviderByIndex: (index) => {
          const state = get()
          const providerIndex = index - 1
          if (providerIndex >= 0 && providerIndex < state.aiConfigManager.providers.length) {
            return state.aiConfigManager.providers[providerIndex]
          }
          return undefined
        },

        createAIProviderFromTemplate: (template) => {
          const templateConfig = aiProviderTemplates[template]
          if (!templateConfig) return -1

          const newProvider: AIProviderConfig = {
            provider: templateConfig.provider,
            apiKey: templateConfig.apiKey,
            apiUrl: templateConfig.apiUrl,
            model: templateConfig.model,
            temperature: templateConfig.temperature,
            proxyUrl: templateConfig.proxyUrl,
            proxyEnabled: templateConfig.proxyEnabled,
            customFields: templateConfig.customFields
          }

          set((prevState) => {
            const newIndex = prevState.aiConfigManager.providers.length + 1
            const newAIConfigManager = {
              ...prevState.aiConfigManager,
              providers: [...prevState.aiConfigManager.providers, newProvider],
              currentModelId: newIndex
            }
            return {
              aiConfigManager: newAIConfigManager,
              aiConfig: computeAIConfig(newAIConfigManager)
            }
          })

          return newProvider.model ? newProvider.model.length : -1
        },

        getAvailableAITemplates: () => {
          return Object.entries(aiProviderTemplates).map(([id, template]) => ({
            id,
            name: template.name,
            description: template.description
          }))
        },
        
        // AI配置管理器方法（直接访问）
        addProvider: (config) => {
          const state = get()
          return state.addAIProvider(config)
        },

        updateProvider: (index, config) => {
          const state = get()
          state.updateAIProvider(index, config)
        },

        deleteProvider: (index) => {
          const state = get()
          state.deleteAIProvider(index)
        },

        duplicateProvider: (index) => {
          const state = get()
          return state.duplicateAIProvider(index)
        },

        getProviderByIndex: (index) => {
          const state = get()
          return state.getAIProviderByIndex(index)
        },

        
        // 处理选项
        processingOptions: defaultProcessingOptions,
        setProcessingMode: (processingMode) => set((state) => ({
          processingOptions: { ...state.processingOptions, processingMode }
        })),
        setBookType: (bookType) => set((state) => ({
          processingOptions: { ...state.processingOptions, bookType }
        })),
        setUseSmartDetection: (useSmartDetection) => set((state) => ({
          processingOptions: { ...state.processingOptions, useSmartDetection }
        })),
        setSkipNonEssentialChapters: (skipNonEssentialChapters) => set((state) => ({
          processingOptions: { ...state.processingOptions, skipNonEssentialChapters }
        })),
        setMaxSubChapterDepth: (maxSubChapterDepth) => set((state) => ({
          processingOptions: { ...state.processingOptions, maxSubChapterDepth }
        })),
        setOutputLanguage: (outputLanguage) => set((state) => ({
          processingOptions: { ...state.processingOptions, outputLanguage }
        })),
        setChapterNamingMode: (chapterNamingMode) => set((state) => ({
          processingOptions: { ...state.processingOptions, chapterNamingMode }
        })),
        setEnableNotification: (enableNotification) => set((state) => ({
          processingOptions: { ...state.processingOptions, enableNotification }
        })),
        setChapterDetectionMode: (chapterDetectionMode) => set((state) => ({
          processingOptions: { ...state.processingOptions, chapterDetectionMode }
        })),
        setEpubTocDepth: (epubTocDepth) => set((state) => ({
          processingOptions: { ...state.processingOptions, epubTocDepth }
        })),
        
        // WebDAV配置
        webdavConfig: defaultWebDAVConfig,
        setWebDAVEnabled: (enabled) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, enabled }
        })),
        setWebDAVServerUrl: (serverUrl) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, serverUrl }
        })),
        setWebDAVUsername: (username) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, username }
        })),
        setWebDAVPassword: (password) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, password }
        })),
        setWebDAVAppName: (appName) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, appName }
        })),
        setWebDAVAutoSync: (autoSync) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, autoSync }
        })),
        setWebDAVSyncPath: (syncPath) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, syncPath }
        })),
        setWebDAVBrowsePath: (browsePath) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, browsePath }
        })),
        setWebDAVConnectionStatus: (connectionStatus) => set((state) => ({
          webdavConfig: { ...state.webdavConfig, connectionStatus }
        })),

        updateWebDAVLastSyncTime: () => set((state) => ({
          webdavConfig: {
            ...state.webdavConfig,
            lastSyncTime: new Date().toISOString()
          }
        })),
        resetWebDAVConfig: () => set(() => ({
          webdavConfig: defaultWebDAVConfig
        })),

        // 提示词配置
        promptConfig: defaultPromptConfig,
        promptVersionConfig: defaultPromptVersionConfig,
        currentPromptVersion: 'v1',
        setCurrentPromptVersion: (version) => set((state) => {
          const newPromptConfig = state.promptVersionConfig[version]
          return {
            currentPromptVersion: version,
            promptConfig: newPromptConfig
          }
        }),
        setChapterSummaryPrompt: (bookType, prompt) => set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            chapterSummary: {
              ...state.promptConfig.chapterSummary,
              [bookType]: prompt
            }
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),
        setMindmapPrompt: (mindmapType, prompt) => set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            mindmap: {
              ...state.promptConfig.mindmap,
              [mindmapType]: prompt
            }
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),
        setConnectionAnalysisPrompt: (prompt) => set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            connectionAnalysis: prompt
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),
        setOverallSummaryPrompt: (prompt) => set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            overallSummary: prompt
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),
        resetPromptsToDefault: () => set((state) => ({
          promptConfig: state.currentPromptVersion === 'v1' ? DEFAULT_PROMPT_CONFIG : DEFAULT_PROMPT_CONFIG_V2,
          promptVersionConfig: {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: state.currentPromptVersion === 'v1' ? DEFAULT_PROMPT_CONFIG : DEFAULT_PROMPT_CONFIG_V2
          }
        })),
        resetPromptsToDefaultForVersion: (version) => set((state) => {
          const defaultConfig = version === 'v1' ? DEFAULT_PROMPT_CONFIG : DEFAULT_PROMPT_CONFIG_V2
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [version]: defaultConfig
          }
          const newPromptConfig = state.currentPromptVersion === version ? defaultConfig : state.promptConfig
          
          return {
            promptConfig: newPromptConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

        // AI服务选项
        aiServiceOptions: defaultAIServiceOptions,
        setMaxRetries: (maxRetries) => set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, maxRetries }
        })),
        setBaseRetryDelay: (baseRetryDelay) => set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, baseRetryDelay }
        })),

        // 配置导出导入功能
        exportConfig: () => {
          const state = get()
          return ConfigExportService.exportConfig(state)
        },

        importConfig: (yamlContent) => {
          try {
            const importedConfig = ConfigExportService.importConfig(yamlContent)
            
            // 验证配置
            const validation = ConfigExportService.validateConfig(importedConfig)
            if (!validation.isValid) {
              return {
                success: false,
                error: `配置验证失败: ${validation.errors.join(', ')}`
              }
            }

            // 应用导入的配置
            set(() => {
              const currentPromptVersion = importedConfig.config.currentPromptVersion
              const promptConfig = importedConfig.config.promptVersionConfig[currentPromptVersion]

              return {
                aiConfigManager: importedConfig.config.aiConfigManager,
                processingOptions: importedConfig.config.processingOptions,
                webdavConfig: importedConfig.config.webdavConfig,
                promptConfig,
                promptVersionConfig: importedConfig.config.promptVersionConfig,
                currentPromptVersion,
                tokenUsage: importedConfig.config.tokenUsage,
                aiConfig: computeAIConfig(importedConfig.config.aiConfigManager)
              }
            })

            return { success: true }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '导入配置时发生未知错误'
            }
          }
        },

        resetAllConfig: () => {
          set(() => ({
            aiConfigManager: createDefaultAIConfigManager(),
            processingOptions: defaultProcessingOptions,
            webdavConfig: defaultWebDAVConfig,
            promptConfig: defaultPromptConfig,
            promptVersionConfig: defaultPromptVersionConfig,
            currentPromptVersion: 'v1',
            tokenUsage: 0,
            aiServiceOptions: defaultAIServiceOptions,
            aiConfig: defaultAIConfig
          }))
        }
      }
    },
    {
      name: 'ebook-mindmap-config', // localStorage中的键名
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

// 导出便捷的选择器
export const useAIConfig = () => useConfigStore((state) => state.aiConfig)
export const useTokenUsage = () => useConfigStore((state) => state.tokenUsage)
export const useProcessingOptions = () => useConfigStore((state) => state.processingOptions)
export const useWebDAVConfig = () => useConfigStore((state) => state.webdavConfig)
export const useAIServiceOptions = () => useConfigStore((state) => state.aiServiceOptions)
export const usePromptConfig = () => useConfigStore((state) => state.promptConfig)
export const usePromptVersionConfig = () => useConfigStore((state) => state.promptVersionConfig)
export const useCurrentPromptVersion = () => useConfigStore((state) => state.currentPromptVersion)