// 处理选项 Store（含汇率与 AI 重试参数：都属于「怎么处理」的共享配置）
import { create } from 'zustand'
import type { AIServiceOptions, ProcessingOptions } from '../types'
import type { SupportedLanguage } from '../../services/prompts/utils'
import { DEFAULT_EXCHANGE_RATE } from '../types'
import { markDirty, registerSection } from '../../services/shared/sharedState'

const SECTION = 'processing' as const

export const defaultProcessingOptions: ProcessingOptions = {
  processingMode: 'mindmap',
  bookType: 'non-fiction',
  useSmartDetection: false,
  skipNonEssentialChapters: true,
  maxSubChapterDepth: 0,
  outputLanguage: 'auto',
  chapterNamingMode: 'auto',
  enableNotification: true,
  chapterDetectionMode: 'normal',
  epubTocDepth: 1,
  chapterConcurrency: 3,
}

export const defaultAIServiceOptions: AIServiceOptions = {
  maxRetries: 3,
  baseRetryDelay: 60000, // 60 秒
}

export interface ProcessingSectionData {
  processingOptions: ProcessingOptions
  exchangeRateUsdToCny: number
  aiServiceOptions: AIServiceOptions
}

export interface ProcessingState extends ProcessingSectionData {
  // Actions
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
  setExchangeRateUsdToCny: (rate: number) => void
  setMaxRetries: (maxRetries: number) => void
  setBaseRetryDelay: (baseRetryDelay: number) => void
  updateAIServiceOptions: (options: Partial<AIServiceOptions>) => void

  // 批量更新
  updateProcessingOptions: (options: Partial<ProcessingOptions>) => void

  // 整体替换（导入 / hydrate）
  replaceProcessing: (data: ProcessingDataInput) => void

  // 重置
  resetProcessingOptions: () => void
}

function clampConcurrency(value: unknown, fallback = 3): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(10, Math.max(1, Math.floor(value) || fallback))
}

/** 归一化输入：允许省略字段（导入的旧配置往往不完整） */
export interface ProcessingDataInput {
  processingOptions?: Partial<ProcessingOptions>
  exchangeRateUsdToCny?: number
  aiServiceOptions?: Partial<AIServiceOptions>
}

/** 归一化：补齐缺省字段并夹紧取值范围 */
export function normalizeProcessingData(input: ProcessingDataInput | undefined): ProcessingSectionData {
  const po: Partial<ProcessingOptions> = input?.processingOptions ?? {}
  const options: ProcessingOptions = { ...defaultProcessingOptions, ...po }
  options.chapterConcurrency = clampConcurrency(po.chapterConcurrency, defaultProcessingOptions.chapterConcurrency)

  const rate =
    typeof input?.exchangeRateUsdToCny === 'number' && Number.isFinite(input.exchangeRateUsdToCny) && input.exchangeRateUsdToCny > 0
      ? input.exchangeRateUsdToCny
      : DEFAULT_EXCHANGE_RATE

  const serviceOptions = { ...defaultAIServiceOptions, ...(input?.aiServiceOptions ?? {}) }

  return { processingOptions: options, exchangeRateUsdToCny: rate, aiServiceOptions: serviceOptions }
}

export const useProcessingStore = create<ProcessingState>()((set, get) => {
  const commit = (patch: Partial<ProcessingSectionData>) => {
    const state = get()
    set({
      ...normalizeProcessingData({
        processingOptions: state.processingOptions,
        exchangeRateUsdToCny: state.exchangeRateUsdToCny,
        aiServiceOptions: state.aiServiceOptions,
        ...patch,
      }),
    })
    markDirty(SECTION)
  }

  const setOption = <K extends keyof ProcessingOptions>(key: K, value: ProcessingOptions[K]) => {
    commit({ processingOptions: { ...get().processingOptions, [key]: value } })
  }

  return {
    ...normalizeProcessingData(undefined),

    setProcessingMode: (v) => setOption('processingMode', v),
    setBookType: (v) => setOption('bookType', v),
    setUseSmartDetection: (v) => setOption('useSmartDetection', v),
    setSkipNonEssentialChapters: (v) => setOption('skipNonEssentialChapters', v),
    setMaxSubChapterDepth: (v) => setOption('maxSubChapterDepth', v),
    setOutputLanguage: (v) => setOption('outputLanguage', v),
    setChapterNamingMode: (v) => setOption('chapterNamingMode', v),
    setEnableNotification: (v) => setOption('enableNotification', v),
    setChapterDetectionMode: (v) => setOption('chapterDetectionMode', v),
    setEpubTocDepth: (v) => setOption('epubTocDepth', v),
    setChapterConcurrency: (v) => setOption('chapterConcurrency', clampConcurrency(v)),

    setExchangeRateUsdToCny: (rate) => commit({ exchangeRateUsdToCny: rate }),

    setMaxRetries: (maxRetries) =>
      commit({ aiServiceOptions: { ...get().aiServiceOptions, maxRetries } }),

    setBaseRetryDelay: (baseRetryDelay) =>
      commit({ aiServiceOptions: { ...get().aiServiceOptions, baseRetryDelay } }),

    updateAIServiceOptions: (options) =>
      commit({ aiServiceOptions: { ...get().aiServiceOptions, ...options } }),

    updateProcessingOptions: (options) =>
      commit({ processingOptions: { ...get().processingOptions, ...options } }),

    replaceProcessing: (data) => {
      set(normalizeProcessingData({ ...get(), ...data }))
      markDirty(SECTION)
    },

    resetProcessingOptions: () => {
      set(normalizeProcessingData(undefined))
      markDirty(SECTION)
    },
  }
})

registerSection<ProcessingSectionData>(
  SECTION,
  {
    getData: () => {
      const { processingOptions, exchangeRateUsdToCny, aiServiceOptions } = useProcessingStore.getState()
      return { processingOptions, exchangeRateUsdToCny, aiServiceOptions }
    },
    setData: (data) => useProcessingStore.setState(normalizeProcessingData(data)),
    debounceMs: 800,
  },
  { autoWrite: false }
)

// 便捷选择器
export const useProcessingOptions = () => useProcessingStore((state) => state.processingOptions)
export const useAIServiceOptions = () => useProcessingStore((state) => state.aiServiceOptions)
export const useExchangeRate = () => useProcessingStore((state) => state.exchangeRateUsdToCny)
