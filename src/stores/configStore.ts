// ConfigStore - 兼容壳
//
// 所有状态与方法都转发到子 store；本壳不持有数据（数据由各子 store 从服务端共享状态 hydrate）。
// 新代码请直接用子 store 的 selector。
import { create } from 'zustand'
import type {
  AIServiceOptions,
  AIProviderConfig,
  PromptConfig,
  ProcessingOptions,
  WebDAVConfig,
} from './types'
import type { PromptOverrides } from './types'
import type { AIState } from '../types/ai'
import {
  ConfigExportService,
  validateImportPlan,
  type ExportOptions,
  type ImportPlan,
  type ImportPreview,
} from '../services/configExportService'
import { logger } from '../lib/logger'

import { useAIConfigStore, getPendingSecrets } from './ai-config'
import { useProcessingStore } from './processing'
import { useWebDAVStore, getPendingWebDAVPassword } from './webdav'
import { usePromptStore } from './prompts'
import { useUsageStore } from './usage'
import { useProcessingHistoryStore } from './processingHistory'
import { flushAllSections, flushSection, loadAll } from '../services/shared/sharedState'

export type { PromptConfig, WebDAVConfig }
/** @deprecated 使用 AIProviderConfig 替代 */
export type { AIProviderConfig as AIConfig }

export interface ConfigState {
  // AI 配置
  ai: AIState
  aiConfig: AIProviderConfig
  getActiveAIProvider: () => AIProviderConfig | undefined

  // Token 使用量
  tokenUsage: number
  totalCostUSD: number
  addTokenUsage: (tokens: number, costUSD?: number, model?: string) => void
  resetTokenUsage: () => void

  // 处理选项
  processingOptions: ProcessingOptions
  exchangeRateUsdToCny: number
  setProcessingMode: (mode: ProcessingOptions['processingMode']) => void
  setBookType: (type: ProcessingOptions['bookType']) => void
  setUseSmartDetection: (enabled: boolean) => void
  setSkipNonEssentialChapters: (enabled: boolean) => void
  setMaxSubChapterDepth: (depth: number) => void
  setOutputLanguage: (language: ProcessingOptions['outputLanguage']) => void
  setChapterNamingMode: (mode: ProcessingOptions['chapterNamingMode']) => void
  setEnableNotification: (enabled: boolean) => void
  setChapterDetectionMode: (mode: ProcessingOptions['chapterDetectionMode']) => void
  setEpubTocDepth: (depth: number) => void
  setChapterConcurrency: (concurrency: number) => void
  setExchangeRateUsdToCny: (rate: number) => void
  updateProcessingOptions: (options: Partial<ProcessingOptions>) => void

  // WebDAV 配置
  webdavConfig: WebDAVConfig
  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  setWebDAVPassword: (password: string | null) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void
  setWebDAVBrowsePath: (browsePath: string) => void
  setWebDAVConnectionStatus: (status: WebDAVConfig['connectionStatus']) => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void
  updateWebDAVConfig: (config: Partial<WebDAVConfig>) => void

  // 提示词
  promptConfig: PromptConfig
  promptOverrides: PromptOverrides
  setChapterSummaryPrompt: (bookType: 'fiction' | 'non-fiction', prompt: string) => void
  setMindmapPrompt: (mindmapType: 'chapter' | 'arrow' | 'combined', prompt: string) => void
  setConnectionAnalysisPrompt: (prompt: string) => void
  setOverallSummaryPrompt: (prompt: string) => void
  resetPromptsToDefault: () => void
  resetPrompt: (path: Parameters<ReturnType<typeof usePromptStore.getState>['resetPrompt']>[0]) => void

  // AI 服务选项
  aiServiceOptions: AIServiceOptions
  setMaxRetries: (maxRetries: number) => void
  setBaseRetryDelay: (baseRetryDelay: number) => void

  // 配置导出导入
  exportConfig: (options?: ExportOptions) => string
  previewImport: (yamlContent: string) => { preview?: ImportPreview; plan?: ImportPlan; error?: string }
  applyImportPlan: (plan: ImportPlan) => { success: boolean; error?: string }
  importConfig: (yamlContent: string) => { success: boolean; error?: string }
  resetAllConfig: () => void

  /** 重新从服务端拉全量（初始化向导完成后使用） */
  reloadSharedState: () => Promise<void>
  /**
   * 把当前（默认或刚导入的）配置强制写入服务端，作为「已初始化」基线。
   *
   * 初始化向导必须用 force：本地值此时恰好等于默认值，普通 flush 会短路，服务端仍是空的，
   * 向导会一直循环。
   */
  initializeSharedState: () => Promise<void>
}

const getAggregatedState = () => {
  const aiState = useAIConfigStore.getState()
  const processingState = useProcessingStore.getState()
  const webdavState = useWebDAVStore.getState()
  const promptState = usePromptStore.getState()
  const usageState = useUsageStore.getState()

  return {
    ai: aiState.ai,
    aiConfig: aiState.aiConfig,
    tokenUsage: usageState.tokenUsage,
    totalCostUSD: usageState.totalCostUSD,
    processingOptions: processingState.processingOptions,
    exchangeRateUsdToCny: processingState.exchangeRateUsdToCny,
    webdavConfig: webdavState.webdavConfig,
    promptConfig: promptState.promptConfig,
    promptOverrides: promptState.overrides,
    aiServiceOptions: processingState.aiServiceOptions,
  }
}

export const useConfigStore = create<ConfigState>()((_set, get) => ({
  ...getAggregatedState(),

  getActiveAIProvider: () => {
    const { ai } = useAIConfigStore.getState()
    const provider =
      ai.providers.find((p) => p.id === ai.active.providerId) ??
      ai.providers.find((p) => p.models.some((m) => m.enabled))
    if (!provider) return undefined
    return useAIConfigStore.getState().aiConfig
  },

  // ===== Token / 费用 =====
  addTokenUsage: (tokens, costUSD, model) => {
    useUsageStore.getState().addTokenUsage(tokens, costUSD, model)
  },
  resetTokenUsage: () => {
    useUsageStore.getState().resetTokenUsage()
  },

  // ===== 处理选项 =====
  setProcessingMode: (v) => useProcessingStore.getState().setProcessingMode(v),
  setBookType: (v) => useProcessingStore.getState().setBookType(v),
  setUseSmartDetection: (v) => useProcessingStore.getState().setUseSmartDetection(v),
  setSkipNonEssentialChapters: (v) => useProcessingStore.getState().setSkipNonEssentialChapters(v),
  setMaxSubChapterDepth: (v) => useProcessingStore.getState().setMaxSubChapterDepth(v),
  setOutputLanguage: (v) => useProcessingStore.getState().setOutputLanguage(v),
  setChapterNamingMode: (v) => useProcessingStore.getState().setChapterNamingMode(v),
  setEnableNotification: (v) => useProcessingStore.getState().setEnableNotification(v),
  setChapterDetectionMode: (v) => useProcessingStore.getState().setChapterDetectionMode(v),
  setEpubTocDepth: (v) => useProcessingStore.getState().setEpubTocDepth(v),
  setChapterConcurrency: (v) => useProcessingStore.getState().setChapterConcurrency(v),
  setExchangeRateUsdToCny: (rate) => useProcessingStore.getState().setExchangeRateUsdToCny(rate),
  updateProcessingOptions: (options) => useProcessingStore.getState().updateProcessingOptions(options),

  // ===== WebDAV =====
  setWebDAVEnabled: (v) => useWebDAVStore.getState().setWebDAVEnabled(v),
  setWebDAVServerUrl: (v) => useWebDAVStore.getState().setWebDAVServerUrl(v),
  setWebDAVUsername: (v) => useWebDAVStore.getState().setWebDAVUsername(v),
  setWebDAVPassword: (v) => useWebDAVStore.getState().setWebDAVPassword(v),
  setWebDAVAppName: (v) => useWebDAVStore.getState().setWebDAVAppName(v),
  setWebDAVAutoSync: (v) => useWebDAVStore.getState().setWebDAVAutoSync(v),
  setWebDAVSyncPath: (v) => useWebDAVStore.getState().setWebDAVSyncPath(v),
  setWebDAVBrowsePath: (v) => useWebDAVStore.getState().setWebDAVBrowsePath(v),
  setWebDAVConnectionStatus: (v) => useWebDAVStore.getState().setWebDAVConnectionStatus(v),
  updateWebDAVLastSyncTime: () => useWebDAVStore.getState().updateWebDAVLastSyncTime(),
  resetWebDAVConfig: () => useWebDAVStore.getState().resetWebDAVConfig(),
  updateWebDAVConfig: (config) => useWebDAVStore.getState().updateWebDAVConfig(config),

  // ===== 提示词 =====
  setChapterSummaryPrompt: (bookType, prompt) =>
    usePromptStore.getState().setChapterSummaryPrompt(bookType, prompt),
  setMindmapPrompt: (type, prompt) => usePromptStore.getState().setMindmapPrompt(type, prompt),
  setConnectionAnalysisPrompt: (prompt) =>
    usePromptStore.getState().setConnectionAnalysisPrompt(prompt),
  setOverallSummaryPrompt: (prompt) => usePromptStore.getState().setOverallSummaryPrompt(prompt),
  resetPromptsToDefault: () => usePromptStore.getState().resetAllPrompts(),
  resetPrompt: (path) => usePromptStore.getState().resetPrompt(path),

  // ===== AI 服务选项 =====
  setMaxRetries: (v) => useProcessingStore.getState().setMaxRetries(v),
  setBaseRetryDelay: (v) => useProcessingStore.getState().setBaseRetryDelay(v),

  // ===== 导出 / 导入 =====
  exportConfig: (options) => {
    const state = getAggregatedState()
    return ConfigExportService.exportConfig(
      {
        ai: state.ai,
        processingOptions: state.processingOptions,
        exchangeRateUsdToCny: state.exchangeRateUsdToCny,
        webdav: state.webdavConfig,
        prompts: state.promptOverrides,
        tokenUsage: state.tokenUsage,
      },
      {
        ...options,
        // 服务端已保存的密钥浏览器读不到（这正是设计目标），所以「包含密钥」只能导出
        // 本次会话里用户新输入、尚未提交的那部分。
        ...(options?.includeSecrets
          ? { providerSecrets: getPendingSecrets(), webdavPassword: getPendingWebDAVPassword() }
          : {}),
      }
    )
  },

  previewImport: (yamlContent) => {
    try {
      const plan = ConfigExportService.importConfig(yamlContent)
      return { plan, preview: ConfigExportService.preview(plan) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '配置解析失败' }
    }
  },

  applyImportPlan: (plan) => {
    const errors = validateImportPlan(plan)
    if (errors.length > 0) return { success: false, error: errors.join('; ') }

    try {
      // AI 服务商 + 待提交密钥
      useAIConfigStore.getState().replaceAI(plan.ai)
      for (const [providerId, apiKey] of Object.entries(plan.providerSecrets)) {
        useAIConfigStore.getState().setProviderSecret(providerId, apiKey)
      }

      if (plan.processing) {
        useProcessingStore.getState().updateProcessingOptions(plan.processing)
      }
      if (typeof plan.exchangeRateUsdToCny === 'number') {
        useProcessingStore.getState().setExchangeRateUsdToCny(plan.exchangeRateUsdToCny)
      }

      useWebDAVStore.getState().replaceWebDAV(plan.webdav)
      if (plan.webdavPassword) {
        useWebDAVStore.getState().setWebDAVPassword(plan.webdavPassword)
      }

      usePromptStore.getState().replacePrompts(plan.prompts)

      // 导入后立刻落盘，避免用户直接关页面丢失
      void Promise.all([
        flushSection('ai'),
        flushSection('processing'),
        flushSection('webdav'),
        flushSection('prompts'),
      ]).catch((error) => logger.error('[ConfigStore] 导入后写回失败:', error))

      return { success: true }
    } catch (error) {
      logger.error('[ConfigStore] 导入配置失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '导入配置时发生未知错误',
      }
    }
  },

  importConfig: (yamlContent) => {
    const { plan, error } = get().previewImport(yamlContent)
    if (!plan) return { success: false, error }
    return get().applyImportPlan(plan)
  },

  resetAllConfig: () => {
    useAIConfigStore.getState().resetAIConfig()
    useProcessingStore.getState().resetProcessingOptions()
    useWebDAVStore.getState().resetWebDAVConfig()
    usePromptStore.getState().resetAllPrompts()
    useUsageStore.getState().resetTokenUsage()
    useProcessingHistoryStore.getState().clearLocalView()
  },

  reloadSharedState: async () => {
    await loadAll()
  },

  initializeSharedState: async () => {
    await flushAllSections({ force: true })
  },
}))

// 子store → 兼容壳 单向同步（任何途径改子store，壳都跟着变）
const sync = () => useConfigStore.setState(getAggregatedState())
useAIConfigStore.subscribe(sync)
useProcessingStore.subscribe(sync)
useWebDAVStore.subscribe(sync)
usePromptStore.subscribe(sync)
useUsageStore.subscribe(sync)

// 便捷选择器
export const useAIConfig = () => useAIConfigStore((state) => state.aiConfig)
export const useTokenUsage = () => useUsageStore((state) => state.tokenUsage)
export const useTotalCostUSD = () => useUsageStore((state) => state.totalCostUSD)
export const useProcessingOptions = () => useProcessingStore((state) => state.processingOptions)
export const useWebDAVConfig = () => useWebDAVStore((state) => state.webdavConfig)
export const useAIServiceOptions = () => useProcessingStore((state) => state.aiServiceOptions)
export const usePromptConfig = () => usePromptStore((state) => state.promptConfig)
export const usePromptOverrides = () => usePromptStore((state) => state.overrides)
export const useExchangeRate = () => useProcessingStore((state) => state.exchangeRateUsdToCny)
