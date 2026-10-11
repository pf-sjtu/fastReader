// 一次性迁移：拆分 store 之前的 ebook-mindmap-config → 各子 store 的独立键
// 拆分前的老用户只有旧键，子 store 是默认值；若不迁移，首次调用 setter 会用默认值覆盖服务商配置。
import type { AIConfigManager, PromptVersionConfig, ProcessingOptions, WebDAVConfig, AIServiceOptions } from './types'
import { useAIConfigStore, mergeAIConfigManager, AI_CONFIG_STORAGE_KEY } from './ai-config'
import { useProcessingStore, PROCESSING_STORAGE_KEY } from './processing'
import { useWebDAVStore, WEBDAV_STORAGE_KEY } from './webdav'
import { usePromptStore, PROMPT_STORAGE_KEY } from './prompts'
import { useCoreStore, CORE_STORAGE_KEY } from './core'
import { logger } from '../lib/logger'
import { DEFAULT_PROMPT_VERSION } from '../services/prompts/templates'

export const LEGACY_CONFIG_KEY = 'ebook-mindmap-config'

interface LegacyConfigState {
  aiConfigManager?: Partial<AIConfigManager>
  processingOptions?: Partial<ProcessingOptions>
  webdavConfig?: Partial<WebDAVConfig>
  promptVersionConfig?: PromptVersionConfig
  currentPromptVersion?: 'v1' | 'v2'
  aiServiceOptions?: AIServiceOptions
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * 迁移规则：
 * - 子 store 键不存在 → 用旧键对应字段填充（老用户）
 * - AI 服务商例外：旧键里的 aiConfigManager 总是优先。兼容壳从旧键水合，界面一直展示的是它；
 *   而旧版 setApiKey 等只回写 aiConfig、不回写 manager，子 store 的 manager 可能是默认值或被误改。
 * 迁移完成后删除旧键（其字段全部与子 store 重复）。
 * @returns 是否执行了迁移
 */
export function migrateLegacyConfig(storage: Storage | null = getStorage()): boolean {
  if (!storage) return false
  let raw: string | null
  try {
    raw = storage.getItem(LEGACY_CONFIG_KEY)
  } catch {
    return false
  }
  if (!raw) return false

  let legacy: LegacyConfigState
  try {
    legacy = (JSON.parse(raw)?.state ?? {}) as LegacyConfigState
  } catch (error) {
    logger.warn('[legacyMigration] 旧配置解析失败，保留旧键不动:', error)
    return false
  }

  const absent = (key: string) => storage.getItem(key) === null

  if (Array.isArray(legacy.aiConfigManager?.providers)) {
    useAIConfigStore.setState((s) => mergeAIConfigManager(s, legacy.aiConfigManager))
  }

  if (legacy.processingOptions && absent(PROCESSING_STORAGE_KEY)) {
    useProcessingStore.getState().updateProcessingOptions(legacy.processingOptions)
  }

  if (legacy.webdavConfig && absent(WEBDAV_STORAGE_KEY)) {
    useWebDAVStore.getState().updateWebDAVConfig(legacy.webdavConfig)
  }

  if (legacy.promptVersionConfig?.v1 && legacy.promptVersionConfig?.v2 && absent(PROMPT_STORAGE_KEY)) {
    // 显式记录的版本原样保留；未记录时按当前默认
    const version =
      legacy.currentPromptVersion === 'v1' || legacy.currentPromptVersion === 'v2'
        ? legacy.currentPromptVersion
        : DEFAULT_PROMPT_VERSION
    usePromptStore.setState({
      promptVersionConfig: legacy.promptVersionConfig,
      currentPromptVersion: version,
      promptConfig: legacy.promptVersionConfig[version]
    })
  }

  if (legacy.aiServiceOptions && absent(CORE_STORAGE_KEY)) {
    useCoreStore.getState().updateAIServiceOptions(legacy.aiServiceOptions)
  }

  // AI 子 store 若未被写过（无服务商数据时）也落一次盘，保证旧键删除后数据仍在
  if (absent(AI_CONFIG_STORAGE_KEY)) {
    useAIConfigStore.setState({})
  }

  try {
    storage.removeItem(LEGACY_CONFIG_KEY)
  } catch {
    // 删除失败不影响使用：下次启动会再迁移一次（结果相同）
  }
  logger.info('[legacyMigration] 已从旧键迁移配置并清理旧键')
  return true
}
