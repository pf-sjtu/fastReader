import { parse, stringify } from 'yaml'
import type {
  AIState,
  ProcessingOptions,
  ProviderEntry,
  WebDAVConfig
} from '../stores/types'
import type { PromptOverrides } from '../stores/types'
import {
  createEmptyAIState,
  DEFAULT_TEMPERATURE,
  migrateLegacyAI,
  normalizeBaseUrl,
  providerIdFor,
  toProtocol,
  deriveProviderName,
  type LegacyAIConfigManager
} from '../stores/aiMigration'
import { diffPromptOverrides } from '../services/prompts/overrides'
import { DEFAULT_PROMPT_CONFIG } from '../services/prompts/templates'
import type { ProviderModel } from '../types/ai'

/** 导出/导入的配置版本：1.0.0 = 旧的扁平模型列表；2.0.0 = 服务商化 */
export const CONFIG_VERSION_V1 = '1.0.0'
export const CONFIG_VERSION_V2 = '2.0.0'
export const SUPPORTED_CONFIG_VERSIONS = [CONFIG_VERSION_V1, CONFIG_VERSION_V2] as const

export const PROVIDER_KEY_PLACEHOLDER = (slug: string) => `\${FASTREADER_PROVIDER_${slug}_KEY}`
export const WEBDAV_PASSWORD_PLACEHOLDER = '${FASTREADER_WEBDAV_PASSWORD}'

/** 导出所需的数据（全部来自共享状态） */
export interface ConfigExportSource {
  ai: AIState
  processingOptions: ProcessingOptions
  exchangeRateUsdToCny: number
  webdav: WebDAVConfig
  prompts: PromptOverrides
  tokenUsage?: number
}

export interface ExportOptions {
  /** 是否导出明文密钥；默认 false（写成 `${FASTREADER_*}` 占位，CLI 可用环境变量替换） */
  includeSecrets?: boolean
  /** includeSecrets 为 true 时用这里的明文覆盖（客户端状态里只有 {hasSecret}） */
  providerSecrets?: Record<string, string>
  webdavPassword?: string
}

export interface FullConfigExportV2 {
  version: typeof CONFIG_VERSION_V2
  exportTime: string
  config: {
    ai: {
      providers: Array<Omit<ProviderEntry, 'apiKey'> & { apiKey?: string }>
      active: AIState['active']
      defaultTemperature: number
    }
    processingOptions: ProcessingOptions
    exchangeRateUsdToCny: number
    webdav: Omit<WebDAVConfig, 'password'> & { password?: string }
    prompts: { overrides: PromptOverrides }
    tokenUsage?: number
  }
}

/** 导入计划：解析结果，尚未写入任何 store */
export interface ImportPlan {
  version: string
  ai: AIState
  /** providerId → 明文 apiKey（导入后需单独上传到服务端） */
  providerSecrets: Record<string, string>
  webdav: WebDAVConfig
  webdavPassword?: string
  processing?: Partial<ProcessingOptions>
  exchangeRateUsdToCny?: number
  prompts: PromptOverrides
  tokenUsage?: number
  notes: string[]
}

/** 供导入预览 UI 使用的摘要 */
export interface ImportPreview {
  version: string
  providerCount: number
  modelCount: number
  providers: Array<{ name: string; baseUrl: string; models: number; hasKey: boolean }>
  promptOverrideKeys: string[]
  webdav: { serverUrl: string; username: string; hasPassword: boolean }
  notes: string[]
}

const isSecretPlaceholder = (value: unknown): boolean =>
  typeof value === 'string' && /^\$\{[A-Z0-9_]+\}$/.test(value)

/** 服务商名 → 环境变量片段 */
export function secretSlug(name: string): string {
  return (name || 'PROVIDER')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'PROVIDER'
}

function promptOverrideKeys(overrides: PromptOverrides): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(overrides.chapterSummary ?? {})) {
    if (typeof v === 'string') keys.push(`chapterSummary.${k}`)
  }
  for (const [k, v] of Object.entries(overrides.mindmap ?? {})) {
    if (typeof v === 'string') keys.push(`mindmap.${k}`)
  }
  if (typeof overrides.connectionAnalysis === 'string') keys.push('connectionAnalysis')
  if (typeof overrides.overallSummary === 'string') keys.push('overallSummary')
  return keys
}

export class ConfigExportService {
  /** 导出 2.0.0 YAML；默认不含明文密钥 */
  static exportConfig(source: ConfigExportSource, options: ExportOptions = {}): string {
    const includeSecrets = options.includeSecrets === true

    const data: FullConfigExportV2 = {
      version: CONFIG_VERSION_V2,
      exportTime: new Date().toISOString(),
      config: {
        ai: {
          providers: source.ai.providers.map((provider) => {
            const apiKey = includeSecrets ? options.providerSecrets?.[provider.id] : PROVIDER_KEY_PLACEHOLDER(secretSlug(provider.name))
            return {
              id: provider.id,
              name: provider.name,
              type: provider.type,
              baseUrl: provider.baseUrl,
              ...(provider.catalogId ? { catalogId: provider.catalogId } : {}),
              ...(apiKey ? { apiKey } : {}),
              models: provider.models,
              ...(provider.modelsFetchedAt ? { modelsFetchedAt: provider.modelsFetchedAt } : {})
            }
          }),
          active: source.ai.active,
          defaultTemperature: source.ai.defaultTemperature
        },
        processingOptions: source.processingOptions,
        exchangeRateUsdToCny: source.exchangeRateUsdToCny,
        webdav: {
          enabled: source.webdav.enabled,
          serverUrl: source.webdav.serverUrl,
          username: source.webdav.username,
          password: includeSecrets
            ? options.webdavPassword ?? ''
            : WEBDAV_PASSWORD_PLACEHOLDER,
          appName: source.webdav.appName,
          autoSync: source.webdav.autoSync,
          syncPath: source.webdav.syncPath,
          browsePath: source.webdav.browsePath,
          lastSyncTime: source.webdav.lastSyncTime,
          connectionStatus: 'disconnected'
        },
        prompts: { overrides: source.prompts },
        ...(typeof source.tokenUsage === 'number' ? { tokenUsage: source.tokenUsage } : {})
      }
    }

    try {
      return stringify(data)
    } catch (error) {
      throw new Error(`配置导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /** 解析任意受支持版本的配置，返回导入计划（不写 store） */
  static importConfig(yamlContent: string): ImportPlan {
    let parsed: Record<string, unknown>
    try {
      parsed = parse(yamlContent) as Record<string, unknown>
    } catch (error) {
      throw new Error(`配置导入失败: ${error instanceof Error ? error.message : 'YAML格式错误'}`)
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('配置文件格式无效：内容为空')
    }

    const version = String(parsed.version ?? '')
    const rawConfig = (parsed.config ?? parsed) as Record<string, unknown>
    if (!parsed.config && !rawConfig.aiConfigManager && !rawConfig.ai) {
      throw new Error('配置文件格式无效，缺少 config 字段')
    }

    if (version && !(SUPPORTED_CONFIG_VERSIONS as readonly string[]).includes(version)) {
      throw new Error(
        `配置文件版本 ${version} 与当前版本 ${SUPPORTED_CONFIG_VERSIONS.join(' / ')} 不兼容`
      )
    }

    if (version === CONFIG_VERSION_V2 || (rawConfig.ai && !rawConfig.aiConfigManager)) {
      return this.parseV2(rawConfig)
    }
    if (version === CONFIG_VERSION_V1 || rawConfig.aiConfigManager) {
      return this.parseV1(rawConfig)
    }

    throw new Error(
      `配置文件版本 ${version || '(缺失)'} 与当前版本 ${SUPPORTED_CONFIG_VERSIONS.join(' / ')} 不兼容`
    )
  }

  private static parseV1(rawConfig: Record<string, unknown>): ImportPlan {
    const notes: string[] = []
    const legacy = rawConfig.aiConfigManager as LegacyAIConfigManager | undefined
    const migrated = migrateLegacyAI(legacy)
    notes.push(...migrated.notes)

    const webdavRaw = (rawConfig.webdavConfig ?? {}) as Record<string, unknown>
    const webdavPassword = typeof webdavRaw.password === 'string' ? webdavRaw.password : undefined

    // 1.0.0 的提示词是「整份配置」，取当前版本（默认 v2）与内置默认求差集
    const versionConfig = rawConfig.promptVersionConfig as Record<string, unknown> | undefined
    const requestedVersion = typeof rawConfig.currentPromptVersion === 'string' ? rawConfig.currentPromptVersion : 'v2'
    const sourcePrompts = (versionConfig?.['v2'] ?? versionConfig?.[requestedVersion]) as
      | Record<string, unknown>
      | undefined
    const prompts = diffPromptOverrides(
      sourcePrompts as Parameters<typeof diffPromptOverrides>[0],
      DEFAULT_PROMPT_CONFIG
    )
    if (requestedVersion !== 'v2' && versionConfig?.[requestedVersion]) {
      notes.push(`旧配置声明的提示词版本为 ${requestedVersion}，已按 v2 处理（v1 已废弃）`)
    }

    return {
      version: CONFIG_VERSION_V1,
      ai: migrated.ai,
      providerSecrets: migrated.secretKeys,
      webdav: normalizeWebdav(webdavRaw),
      ...(webdavPassword ? { webdavPassword } : {}),
      processing: rawConfig.processingOptions as Partial<ProcessingOptions> | undefined,
      prompts,
      ...(typeof rawConfig.tokenUsage === 'number' ? { tokenUsage: rawConfig.tokenUsage } : {}),
      notes
    }
  }

  private static parseV2(rawConfig: Record<string, unknown>): ImportPlan {
    const notes: string[] = []
    const aiRaw = (rawConfig.ai ?? rawConfig.aiConfigManager ?? {}) as Record<string, unknown>
    const providersRaw = Array.isArray(aiRaw.providers) ? (aiRaw.providers as Array<Record<string, unknown>>) : []

    const providerSecrets: Record<string, string> = {}
    const providers: ProviderEntry[] = providersRaw.map((p) => {
      const type = toProtocol(String(p.type ?? p.provider ?? 'openai'))
      const baseUrl = String(p.baseUrl ?? p.apiUrl ?? '')
      const name = String(p.name ?? '') || deriveProviderName(baseUrl, type)
      const rawKey = typeof p.apiKey === 'string' ? p.apiKey : ''
      const isPlaceholder = isSecretPlaceholder(rawKey)
      const apiKey = rawKey && !isPlaceholder ? rawKey : undefined
      const id = typeof p.id === 'string' && p.id ? p.id : providerIdFor(type, baseUrl, apiKey ?? '')
      if (apiKey) providerSecrets[id] = apiKey

      const modelsRaw = Array.isArray(p.models) ? (p.models as Array<Record<string, unknown>>) : []
      const models: ProviderModel[] = modelsRaw
        .map((m) => {
          const modelId = String(m.id ?? '').trim()
          if (!modelId) return null
          const temperature = typeof m.temperature === 'number' ? m.temperature : undefined
          return {
            id: modelId,
            ...(typeof m.label === 'string' && m.label ? { label: m.label } : {}),
            enabled: m.enabled === undefined ? true : Boolean(m.enabled),
            source: m.source === 'auto' ? 'auto' : 'manual',
            ...(temperature !== undefined ? { temperature } : {}),
            ...(m.meta && typeof m.meta === 'object' ? { meta: m.meta as ProviderModel['meta'] } : {})
          } satisfies ProviderModel
        })
        .filter((m): m is ProviderModel => m !== null)

      return {
        id,
        name,
        type,
        baseUrl,
        ...(apiKey || isPlaceholder ? { apiKey: { hasSecret: true } } : {}),
        ...(typeof p.catalogId === 'string' && p.catalogId ? { catalogId: p.catalogId } : {}),
        models,
        ...(typeof p.modelsFetchedAt === 'string' ? { modelsFetchedAt: p.modelsFetchedAt } : {})
      }
    })

    if (providers.length === 0) notes.push('导入的配置中没有可用的服务商')

    const activeRaw = (aiRaw.active ?? {}) as { providerId?: string; modelId?: string }
    const activeProvider =
      providers.find((p) => p.id === activeRaw.providerId) ?? providers[0]
    const activeModel =
      activeProvider?.models.find((m) => m.id === activeRaw.modelId) ??
      activeProvider?.models.find((m) => m.enabled) ??
      activeProvider?.models[0]

    const ai: AIState = providerSecrets || providers
      ? {
          providers,
          active: {
            providerId: activeProvider?.id ?? '',
            modelId: activeModel?.id ?? ''
          },
          defaultTemperature:
            typeof aiRaw.defaultTemperature === 'number' ? aiRaw.defaultTemperature : DEFAULT_TEMPERATURE
        }
      : createEmptyAIState()

    const webdavRaw = (rawConfig.webdav ?? rawConfig.webdavConfig ?? {}) as Record<string, unknown>
    const webdavPasswordRaw = typeof webdavRaw.password === 'string' ? webdavRaw.password : ''
    const webdavPassword =
      webdavPasswordRaw && !isSecretPlaceholder(webdavPasswordRaw) ? webdavPasswordRaw : undefined

    const promptsRaw = (rawConfig.prompts ?? {}) as Record<string, unknown>
    const prompts = (promptsRaw.overrides ?? rawConfig.prompts ?? {}) as PromptOverrides

    return {
      version: CONFIG_VERSION_V2,
      ai,
      providerSecrets,
      webdav: normalizeWebdav(webdavRaw),
      ...(webdavPassword ? { webdavPassword } : {}),
      processing: rawConfig.processingOptions as Partial<ProcessingOptions> | undefined,
      exchangeRateUsdToCny:
        typeof rawConfig.exchangeRateUsdToCny === 'number' ? rawConfig.exchangeRateUsdToCny : undefined,
      prompts: typeof prompts === 'object' && prompts ? prompts : {},
      ...(typeof rawConfig.tokenUsage === 'number' ? { tokenUsage: rawConfig.tokenUsage } : {}),
      notes
    }
  }

  /** 导入预览摘要（UI 在用户确认前展示） */
  static preview(plan: ImportPlan): ImportPreview {
    return {
      version: plan.version,
      providerCount: plan.ai.providers.length,
      modelCount: plan.ai.providers.reduce((sum, p) => sum + p.models.length, 0),
      providers: plan.ai.providers.map((p) => ({
        name: p.name,
        baseUrl: p.baseUrl,
        models: p.models.length,
        hasKey: Boolean(plan.providerSecrets[p.id] || p.apiKey?.hasSecret)
      })),
      promptOverrideKeys: promptOverrideKeys(plan.prompts),
      webdav: {
        serverUrl: plan.webdav.serverUrl,
        username: plan.webdav.username,
        hasPassword: Boolean(plan.webdavPassword || plan.webdav.password?.hasSecret)
      },
      notes: plan.notes
    }
  }

  /** 生成配置文件名 */
  static generateFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `ebook-to-mindmap-config-${timestamp}.yaml`
  }
}

function normalizeWebdav(raw: Record<string, unknown>): WebDAVConfig {
  const passwordRaw = raw.password
  return {
    enabled: Boolean(raw.enabled),
    serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    ...(typeof passwordRaw === 'string' && passwordRaw
      ? { password: { hasSecret: true } }
      : passwordRaw && typeof passwordRaw === 'object' && 'hasSecret' in passwordRaw
        ? { password: { hasSecret: Boolean((passwordRaw as { hasSecret?: boolean }).hasSecret) } }
        : {}),
    appName: typeof raw.appName === 'string' ? raw.appName : 'fastReader_by_PF',
    autoSync: Boolean(raw.autoSync),
    syncPath: typeof raw.syncPath === 'string' ? raw.syncPath : '/fastReader',
    browsePath: typeof raw.browsePath === 'string' ? raw.browsePath : '/',
    lastSyncTime: typeof raw.lastSyncTime === 'string' ? raw.lastSyncTime : null,
    // 运行时状态不随备份迁移
    connectionStatus: 'disconnected'
  }
}

/** 校验一个导入计划是否可用；返回人类可读错误 */
export function validateImportPlan(plan: ImportPlan): string[] {
  const errors: string[] = []
  if (plan.ai.providers.length === 0) {
    errors.push('配置中没有服务商')
  }
  for (const provider of plan.ai.providers) {
    if (!provider.baseUrl) errors.push(`服务商 ${provider.name} 缺少 baseUrl`)
    if (normalizeBaseUrl(provider.baseUrl) === '') errors.push(`服务商 ${provider.name} 的 baseUrl 无效`)
  }
  if (!plan.ai.active.providerId && plan.ai.providers.length > 0) {
    errors.push('配置没有指定当前模型')
  }
  return errors
}
