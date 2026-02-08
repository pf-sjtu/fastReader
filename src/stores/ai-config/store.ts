import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AIProvider,
  AIProviderConfig,
  AIProviderTemplate,
  AIConfigManager,
  AIConfigState
} from './types'

// AI服务商模板配置
const aiProviderTemplates: Record<string, AIProviderTemplate> = {
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

// 默认AI配置
const defaultAIConfig: AIProviderConfig = {
  provider: 'gemini',
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gemini-1.5-flash',
  temperature: 0.7,
  proxyUrl: '',
  proxyEnabled: false
}

// 创建默认AI配置管理器
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

    addProvider: () => 1,
    updateProvider: () => {},
    deleteProvider: () => {},
    duplicateProvider: () => 1,
    setCurrentModelId: () => {},
    getActiveProvider: () => defaultProvider,
    getProviderByIndex: () => defaultProvider,
    createFromTemplate: () => 1,
    getAvailableTemplates: () =>
      Object.entries(aiProviderTemplates).map(([id, template]) => ({
        id,
        name: template.name,
        description: template.description
      }))
  }
}

// 计算aiConfig的辅助函数
const computeAIConfig = (aiConfigManager: AIConfigManager): AIProviderConfig => {
  const index = aiConfigManager.currentModelId - 1
  const activeProvider = aiConfigManager.providers[index]
  if (!activeProvider) {
    return defaultAIConfig
  }

  return {
    provider: activeProvider.provider as AIProvider,
    apiKey: activeProvider.apiKey,
    apiUrl: activeProvider.apiUrl,
    model: activeProvider.model,
    temperature: activeProvider.temperature,
    proxyUrl: activeProvider.proxyUrl || '',
    proxyEnabled: activeProvider.proxyEnabled || false
  }
}

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set, get) => ({
      // 初始化aiConfigManager
      aiConfigManager: createDefaultAIConfigManager(),

      // 向后兼容的AI配置
      aiConfig: computeAIConfig(createDefaultAIConfigManager()),

      // Token使用量追踪
      tokenUsage: 0,
      addTokenUsage: (tokens) =>
        set((state) => ({
          tokenUsage: state.tokenUsage + tokens
        })),
      resetTokenUsage: () =>
        set(() => ({
          tokenUsage: 0
        })),

      // 向后兼容的设置方法
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

      // 新的AI服务商管理方法
      addAIProvider: (config) => {
        const newProvider: AIProviderConfig = {
          ...config
        }

        let newIndex = 1
        set((state) => {
          newIndex = state.aiConfigManager.providers.length + 1
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
          const providerIndex = index - 1
          if (
            providerIndex < 0 ||
            providerIndex >= state.aiConfigManager.providers.length
          ) {
            return state
          }
          const newProviders = [...state.aiConfigManager.providers]
          newProviders[providerIndex] = {
            ...newProviders[providerIndex],
            ...config
          }

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
          const providerIndex = index - 1
          if (
            providerIndex < 0 ||
            providerIndex >= state.aiConfigManager.providers.length
          ) {
            return state
          }

          const newProviders = state.aiConfigManager.providers.filter(
            (_, i) => i !== providerIndex
          )

          let newCurrentModelId = state.aiConfigManager.currentModelId
          if (state.aiConfigManager.currentModelId === index) {
            newCurrentModelId =
              newProviders.length > 0 ? Math.min(index, newProviders.length) : 1
          } else if (state.aiConfigManager.currentModelId > index) {
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
        if (
          providerIndex < 0 ||
          providerIndex >= state.aiConfigManager.providers.length
        ) {
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
        if (
          providerIndex >= 0 &&
          providerIndex < state.aiConfigManager.providers.length
        ) {
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
      }
    }),
    {
      name: 'ai-config-store',
      partialize: (state) => ({
        aiConfigManager: state.aiConfigManager,
        aiConfig: state.aiConfig,
        tokenUsage: state.tokenUsage
      })
    }
  )
)

// 导出便捷选择器
export const useAIConfig = () => useAIConfigStore((state) => state.aiConfig)
export const useTokenUsage = () => useAIConfigStore((state) => state.tokenUsage)
export const useAIConfigManager = () =>
  useAIConfigStore((state) => state.aiConfigManager)
