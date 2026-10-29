/**
 * 旧版 AI 配置 → 服务商化配置的迁移。
 *
 * 旧模型：一条配置 = 一个模型（provider/apiUrl/apiKey/model），同一服务商的 5 个模型 = 5 条重复条目。
 * 新模型：一条配置 = 一个服务商（baseUrl + 凭据）+ 多个模型。
 *
 * 迁移键：`(协议, 规范化 baseUrl, apiKey)`。同键的多条旧条目折叠为一个服务商。
 */
import type {
  AIProtocol,
  AIProviderType,
  AIState,
  ProviderEntry,
  ProviderModel
} from '../types/ai'

/** 旧版单条服务商配置 */
export interface LegacyProviderConfig {
  provider?: string
  apiKey?: string
  apiUrl?: string
  model?: string
  temperature?: number
  proxyUrl?: string
  proxyEnabled?: boolean
  customFields?: Record<string, unknown>
}

/** 旧版 AI 配置管理器数据 */
export interface LegacyAIConfigManager {
  providers?: LegacyProviderConfig[]
  currentModelId?: number
}

/** 迁移结果：客户端可见的服务商状态 + 需要上传到服务端的明文密钥 */
export interface AIMigrationResult {
  ai: AIState
  /** providerEntryId → 明文 apiKey（仅在上行通道使用，不进入客户端状态） */
  secretKeys: Record<string, string>
  /** 迁移过程中被丢弃/归并的信息，用于导入报告 */
  notes: string[]
}

export const DEFAULT_TEMPERATURE = 0.7

/** 旧 provider 值 → 新协议 */
export function toProtocol(provider: string | undefined): AIProtocol {
  switch (provider) {
    case 'gemini':
      return 'gemini'
    case 'ollama':
      return 'ollama'
    case 'anthropic':
      return 'anthropic'
    case 'openai':
    case '302.ai':
    case 'custom':
    default:
      return 'openai'
  }
}

/** 新协议 → 运行时 AIProviderType（兼容旧 provider 注册表） */
export function toRuntimeProviderType(type: AIProtocol): AIProviderType {
  return type
}

/** 规范化 baseUrl：去尾部斜杠、小写协议与主机，用于把同一服务商的条目归到一组 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw || '').trim()
  if (!value) return ''

  // localhost 之类的裸地址没有协议：按 http 补齐（与 Ollama 默认一致）
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
  try {
    const url = new URL(withProtocol)
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}`
  } catch {
    return value.replace(/\/+$/, '').toLowerCase()
  }
}

/** 从 baseUrl 派生服务商显示名：优先 hostname，退化到协议 */
export function deriveProviderName(baseUrl: string, type: AIProtocol): string {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`
    const host = new URL(withProtocol).hostname
    if (host) return host
  } catch {
    // ignore
  }
  return type === 'gemini' ? 'Gemini' : type === 'ollama' ? 'Ollama' : 'OpenAI'
}

/** 生成稳定的服务商 id（导入可重复执行而不产生重复条目） */
export function providerIdFor(protocol: AIProtocol, baseUrl: string, apiKey: string): string {
  const seed = `${protocol}|${normalizeBaseUrl(baseUrl)}|${apiKey}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `p${(hash >>> 0).toString(36)}`
}

export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'

/** 旧配置里 apiUrl 可能为空：按 provider 补默认值 */
function resolveBaseUrl(entry: LegacyProviderConfig): string {
  const raw = (entry.apiUrl || '').trim()
  if (raw) return raw
  switch (toProtocol(entry.provider)) {
    case 'gemini':
      return GEMINI_DEFAULT_BASE_URL
    case 'ollama':
      return OLLAMA_DEFAULT_BASE_URL
    default:
      return OPENAI_DEFAULT_BASE_URL
  }
}

interface GroupBucket {
  protocol: AIProtocol
  baseUrl: string
  apiKey: string
  name: string
  models: ProviderModel[]
  firstIndex: number
}

/**
 * 把旧版 `{ providers, currentModelId }` 折叠为服务商状态。
 *
 * - `currentModelId` 是 1-based，指向旧 providers 数组中的位置
 * - 同组内重复的模型 id 只保留第一条
 * - 不产生任何网络请求（models.dev 元数据在后台上传/首次进入设置时补）
 */
export function migrateLegacyAI(legacy: LegacyAIConfigManager | undefined): AIMigrationResult {
  const notes: string[] = []
  const secretKeys: Record<string, string> = {}
  const entries = Array.isArray(legacy?.providers) ? legacy!.providers! : []

  if (entries.length === 0) {
    return { ai: createEmptyAIState(), secretKeys, notes }
  }

  const buckets = new Map<string, GroupBucket>()

  entries.forEach((entry, index) => {
    const protocol = toProtocol(entry.provider)
    const baseUrl = resolveBaseUrl(entry)
    const apiKey = entry.apiKey || ''
    const normalized = normalizeBaseUrl(baseUrl)
    const groupKey = `${protocol}|${normalized}|${apiKey}`

    let bucket = buckets.get(groupKey)
    if (!bucket) {
      bucket = {
        protocol,
        baseUrl,
        apiKey,
        name: deriveProviderName(baseUrl, protocol),
        models: [],
        firstIndex: index
      }
      buckets.set(groupKey, bucket)
    }

    const modelId = (entry.model || '').trim()
    if (!modelId) {
      notes.push(`第 ${index + 1} 条配置没有模型名，已跳过`)
      return
    }
    if (bucket.models.some((m) => m.id === modelId)) {
      notes.push(`模型 ${modelId} 在同一服务商下重复出现，已合并`)
      return
    }

    const temperature = typeof entry.temperature === 'number' ? entry.temperature : undefined
    bucket.models.push({
      id: modelId,
      enabled: true,
      source: 'manual',
      ...(temperature !== undefined && temperature !== DEFAULT_TEMPERATURE ? { temperature } : {})
    })
  })

  const orderedBuckets = [...buckets.values()].sort((a, b) => a.firstIndex - b.firstIndex)
  const providers: ProviderEntry[] = orderedBuckets.map((bucket) => {
    const id = providerIdFor(bucket.protocol, bucket.baseUrl, bucket.apiKey)
    if (bucket.apiKey) secretKeys[id] = bucket.apiKey
    return {
      id,
      name: bucket.name,
      type: bucket.protocol,
      baseUrl: bucket.baseUrl,
      ...(bucket.apiKey ? { apiKey: { hasSecret: true } } : {}),
      models: bucket.models
    }
  })

  // currentModelId 是 1-based 的旧数组下标：先定位那条旧条目，再在折叠结果里找它的落点
  const requestedIndex = typeof legacy?.currentModelId === 'number' ? legacy.currentModelId - 1 : 0
  const requested = entries[requestedIndex] ?? entries[0]
  const active = locateActive(providers, requested)

  if (entries.length > providers.length) {
    notes.push(`已把 ${entries.length} 条模型配置折叠为 ${providers.length} 个服务商`)
  }

  return {
    ai: { providers, active, defaultTemperature: DEFAULT_TEMPERATURE },
    secretKeys,
    notes
  }
}

function locateActive(
  providers: ProviderEntry[],
  requested: LegacyProviderConfig | undefined
): AIState['active'] {
  const fallback = { providerId: providers[0]?.id ?? '', modelId: providers[0]?.models[0]?.id ?? '' }
  if (!requested) return fallback

  const protocol = toProtocol(requested.provider)
  const normalized = normalizeBaseUrl(resolveBaseUrl(requested))
  const modelId = (requested.model || '').trim()

  const provider =
    providers.find(
      (p) => p.type === protocol && normalizeBaseUrl(p.baseUrl) === normalized && !!modelId
    ) ?? providers[0]
  if (!provider) return fallback

  const model = provider.models.find((m) => m.id === modelId) ?? provider.models[0]
  return { providerId: provider.id, modelId: model?.id ?? '' }
}

export function createEmptyAIState(): AIState {
  return {
    providers: [],
    active: { providerId: '', modelId: '' },
    defaultTemperature: DEFAULT_TEMPERATURE
  }
}
