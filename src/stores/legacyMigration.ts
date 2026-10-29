/**
 * 本机旧配置的一次性导入。
 *
 * 历史版本把所有配置放在浏览器 localStorage（拆分前是单个 `ebook-mindmap-config`，
 * 拆分后是每个子 store 各自的键）。共享状态上线后，这些数据只在新部署「首次初始化」
 * 时被读取一次，转成 ImportPlan 后写入服务端；之后不再使用 localStorage。
 */
import type { ImportPlan } from '../services/configExportService'
import { diffPromptOverrides } from '../services/prompts/overrides'
import { DEFAULT_PROMPT_CONFIG } from '../services/prompts/templates'
import { migrateLegacyAI, type LegacyAIConfigManager } from './aiMigration'
import { normalizeProcessingData } from './processing'
import { defaultWebDAVConfig } from './webdav'
import type { AIServiceOptions, ProcessingOptions, PromptConfig, WebDAVConfig } from './types'
import type { PromptOverrides } from './types'

export const LEGACY_CONFIG_KEY = 'ebook-mindmap-config'
export const LEGACY_AI_KEY = 'ebook-ai-config'
export const LEGACY_PROCESSING_KEY = 'ebook-processing-options'
export const LEGACY_WEBDAV_KEY = 'ebook-webdav-config'
export const LEGACY_PROMPT_KEY = 'ebook-prompt-config'
export const LEGACY_CORE_KEY = 'ebook-core-config'

interface PersistedShape<T> {
  state?: T
  version?: number
}

function readPersisted<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedShape<T> | T
    if (parsed && typeof parsed === 'object' && 'state' in (parsed as PersistedShape<T>)) {
      return ((parsed as PersistedShape<T>).state ?? null) as T | null
    }
    return parsed as T
  } catch {
    return null
  }
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export interface LocalLegacySnapshot {
  ai?: LegacyAIConfigManager
  processingOptions?: Partial<ProcessingOptions>
  aiServiceOptions?: AIServiceOptions
  webdav?: Partial<WebDAVConfig> & { password?: unknown }
  prompts?: { promptConfig?: PromptConfig; promptVersionConfig?: Record<string, PromptConfig>; currentPromptVersion?: string }
}

/** 读取本机旧配置（新键优先，其次拆分前的聚合键） */
export function readLocalLegacyConfig(storage: Storage | null = getStorage()): LocalLegacySnapshot | null {
  if (!storage) return null

  const aggregate = readPersisted<LocalLegacySnapshot>(storage, LEGACY_CONFIG_KEY) ?? {}
  const ai = readPersisted<{ aiConfigManager?: LegacyAIConfigManager }>(storage, LEGACY_AI_KEY)
  const processing = readPersisted<{ processingOptions?: Partial<ProcessingOptions> }>(storage, LEGACY_PROCESSING_KEY)
  const webdav = readPersisted<{ webdavConfig?: WebDAVConfig }>(storage, LEGACY_WEBDAV_KEY)
  const prompts = readPersisted<NonNullable<LocalLegacySnapshot['prompts']>>(storage, LEGACY_PROMPT_KEY)
  const core = readPersisted<{ aiServiceOptions?: AIServiceOptions }>(storage, LEGACY_CORE_KEY)

  const snapshot: LocalLegacySnapshot = {
    ai: ai?.aiConfigManager ?? aggregate.ai,
    processingOptions: processing?.processingOptions ?? aggregate.processingOptions,
    aiServiceOptions: core?.aiServiceOptions ?? aggregate.aiServiceOptions,
    webdav: webdav?.webdavConfig ?? aggregate.webdav,
    prompts: prompts ?? aggregate.prompts,
  }

  const hasAnything = Boolean(
    (snapshot.ai?.providers?.length ?? 0) > 0 ||
      snapshot.processingOptions ||
      snapshot.webdav?.serverUrl ||
      snapshot.prompts?.promptConfig ||
      snapshot.prompts?.promptVersionConfig
  )
  return hasAnything ? snapshot : null
}

/** localStorage 里是否还有旧配置（初始化向导据此显示「导入本机配置」） */
export function hasLocalLegacyConfig(storage: Storage | null = getStorage()): boolean {
  return readLocalLegacyConfig(storage) !== null
}

/** 把本机旧配置转成 ImportPlan（与导入 YAML 走同一条落库路径） */
export function buildImportPlanFromLocal(snapshot: LocalLegacySnapshot): ImportPlan {
  const migrated = migrateLegacyAI(snapshot.ai)

  // 提示词：优先用旧 store 里「当前生效」的完整配置与内置默认求差集
  const promptSource =
    snapshot.prompts?.promptConfig ??
    (snapshot.prompts?.currentPromptVersion && snapshot.prompts.promptVersionConfig
      ? snapshot.prompts.promptVersionConfig[snapshot.prompts.currentPromptVersion]
      : snapshot.prompts?.promptVersionConfig?.v2)

  const prompts = diffPromptOverrides(promptSource, DEFAULT_PROMPT_CONFIG)

  const normalized = normalizeProcessingData({
    processingOptions: snapshot.processingOptions,
    aiServiceOptions: snapshot.aiServiceOptions,
  })

  const webdavRaw = snapshot.webdav ?? {}
  const passwordRaw = webdavRaw.password
  const webdavPassword =
    typeof passwordRaw === 'string'
      ? passwordRaw
      : passwordRaw && typeof passwordRaw === 'object' && 'hasSecret' in passwordRaw
        ? undefined
        : undefined

  const webdav: WebDAVConfig = {
    ...defaultWebDAVConfig,
    ...webdavRaw,
    password: passwordRaw && typeof passwordRaw === 'string' ? { hasSecret: true } : undefined,
    connectionStatus: 'disconnected',
  }

  return {
    version: 'legacy-local',
    ai: migrated.ai,
    providerSecrets: migrated.secretKeys,
    webdav,
    ...(webdavPassword ? { webdavPassword } : {}),
    processing: normalized.processingOptions as ImportPlan['processing'],
    exchangeRateUsdToCny: normalized.exchangeRateUsdToCny,
    prompts: prompts as PromptOverrides,
    notes: [...migrated.notes, '来源：本浏览器旧配置'],
  }
}
