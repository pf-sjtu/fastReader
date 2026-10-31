// Prompt 配置加载器 - 浏览器兼容版本（v2 保留供旧缓存/自定义对照，v3 为默认）
import { parse as parseYaml } from 'yaml'

// Prompt 配置类型定义（含内置 system 段）
export interface PromptConfigWithSystem {
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
  system: {
    testConnection: string
  }
}

/** 支持的提示词版本：v1 已废弃（读到时按 v2 处理） */
export const SUPPORTED_PROMPT_VERSIONS = ['v2', 'v3'] as const
export type PromptVersionId = (typeof SUPPORTED_PROMPT_VERSIONS)[number]

/** 默认 prompt 版本；CLI 的 DEFAULT_PROMPT_VERSION 与之保持一致 */
export const DEFAULT_PROMPT_VERSION: PromptVersionId = 'v3'

const configCache = new Map<string, PromptConfigWithSystem>()

import v2PromptsYaml from './v2-prompts.yaml?raw'
import v3PromptsYaml from './v3-prompts.yaml?raw'

const YAML_BY_VERSION: Record<PromptVersionId, string> = { v2: v2PromptsYaml, v3: v3PromptsYaml }

/** 入参归一：v3 → v3；v2 与历史入参（v1 等）→ v2；缺省 → 默认版本 */
export const normalizePromptVersion = (version?: string): PromptVersionId =>
  version === undefined ? DEFAULT_PROMPT_VERSION : version === 'v3' ? 'v3' : 'v2'

/**
 * 加载 prompt 配置。
 *
 * `v1` 只作为历史入参被接受（旧调用方/旧测试），返回 v2 —— v1 模板已删除。
 */
export const loadPromptConfig = (version: string = DEFAULT_PROMPT_VERSION): PromptConfigWithSystem => {
  const cacheKey = normalizePromptVersion(version)
  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey)!
  }

  try {
    const config = parseYaml(YAML_BY_VERSION[cacheKey]) as PromptConfigWithSystem
    configCache.set(cacheKey, config)
    return config
  } catch (error) {
    console.error(`加载 ${cacheKey} 版本 prompt 配置失败:`, error)
    throw new Error(`无法加载 ${cacheKey} 版本的 prompt 配置`)
  }
}

/** 获取章节总结 prompt */
export const getChapterSummaryPrompt = (
  version: string,
  bookType: 'fiction' | 'nonFiction'
): string => {
  const config = loadPromptConfig(version)
  return config.chapterSummary[bookType]
}

/** 获取思维导图 prompt */
export const getMindmapPrompt = (
  version: string,
  mindmapType: 'chapter' | 'arrow' | 'combined'
): string => {
  const config = loadPromptConfig(version)
  return config.mindmap[mindmapType]
}

/** 获取章节关联分析 prompt */
export const getConnectionAnalysisPrompt = (version: string): string => {
  const config = loadPromptConfig(version)
  return config.connectionAnalysis
}

/** 获取全书总结 prompt */
export const getOverallSummaryPromptTemplate = (version: string): string => {
  const config = loadPromptConfig(version)
  return config.overallSummary
}

/** 兼容旧调用名：获取全书总结 prompt */
export const getOverallSummaryPrompt = getOverallSummaryPromptTemplate

/** 获取系统 prompt */
export const getSystemPrompt = (promptType: 'testConnection'): string => {
  const config = loadPromptConfig(DEFAULT_PROMPT_VERSION)
  return config.system[promptType]
}

/** 清除配置缓存（用于开发时热重载） */
export const clearConfigCache = (): void => {
  configCache.clear()
}
