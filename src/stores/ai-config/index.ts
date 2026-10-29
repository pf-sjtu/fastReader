/**
 * AI 配置 store：服务商维度（baseUrl + 凭据 + 多个模型）。
 *
 * 共享状态（AIState）由服务端持有；store 另外派生一个扁平的运行时视图 `aiConfig`
 * （不含明文凭据），保持 provider 实现与处理链路的最小改动面。
 *
 * 新增的 API Key 只放在内存里的 `pendingSecrets`，随下一次写回提交给服务端，
 * 写入成功后立即清掉——除非用户显式要求，明文不会停留在客户端状态里。
 */
import { create } from 'zustand'
import type {
  ReasoningEffort,
  AIProtocol,
  AIProviderConfig,
  AIState,
  ProviderEntry,
  ProviderModel,
  ProviderModelMeta,
  SecretRef,
} from '../../types/ai'
import { DEFAULT_TEMPERATURE, createEmptyAIState } from '../aiMigration'
import { markDirty, registerSection } from '../../services/shared/sharedState'
import type { AIProviderConfig as LegacyAIConfig } from '../types'

const SECTION = 'ai' as const

/** providerId → 待提交的明文密钥（null 表示清除） */
const pendingSecrets = new Map<string, string | null>()

export interface AIConfigState {
  ai: AIState
  /** 运行时视图（无 apiKey） */
  aiConfig: AIProviderConfig

  // 服务商
  addProvider: (entry: Omit<ProviderEntry, 'id' | 'models'> & { models?: ProviderModel[]; id?: string }) => string
  updateProvider: (id: string, patch: Partial<Omit<ProviderEntry, 'id'>>) => void
  deleteProvider: (id: string) => void
  setProviderSecret: (id: string, apiKey: string | null) => void
  setProviderModels: (id: string, models: ProviderModel[]) => void
  setProviderModelsFromIds: (id: string, ids: string[], metaFor?: (modelId: string) => ProviderModelMeta | undefined) => void
  setModelMeta: (providerId: string, modelId: string, meta: ProviderModelMeta) => void
  setModelEnabled: (providerId: string, modelId: string, enabled: boolean) => void
  setModelTemperature: (providerId: string, modelId: string, temperature: number | undefined) => void
  addManualModel: (providerId: string, modelId: string) => void
  removeModel: (providerId: string, modelId: string) => void

  // 当前模型
  setActiveModel: (providerId: string, modelId: string) => void
  setDefaultTemperature: (temperature: number) => void
  setReasoningEffort: (effort: ReasoningEffort) => void

  // 整体替换（导入 / hydrate / 测试）
  replaceAI: (ai: AIState) => void
  resetAIConfig: () => void

  // 查询
  getProvider: (id: string) => ProviderEntry | undefined
  getActiveProvider: () => ProviderEntry | undefined
  getEnabledModels: (providerId: string) => ProviderModel[]
}

/** 由 AIState 派生扁平运行时视图 */
export function computeAIConfig(ai: AIState): AIProviderConfig {
  const provider =
    ai.providers.find((p) => p.id === ai.active.providerId) ??
    ai.providers.find((p) => p.models.some((m) => m.enabled)) ??
    ai.providers[0]
  if (!provider) {
    return { provider: 'openai', apiUrl: '', model: '', temperature: ai.defaultTemperature, hasCredentials: false }
  }

  const model =
    provider.models.find((m) => m.id === ai.active.modelId && m.enabled) ??
    provider.models.find((m) => m.enabled) ??
    provider.models[0]

  return {
    provider: toRuntimeProvider(provider.type),
    providerId: provider.id,
    apiUrl: provider.baseUrl,
    model: model?.id ?? '',
    temperature: model?.temperature ?? ai.defaultTemperature ?? DEFAULT_TEMPERATURE,
    reasoningEffort: model?.reasoningEffort ?? ai.reasoningEffort ?? 'auto',
    // Ollama 本机直连不需要密钥；其它协议看服务端是否已保存（或本会话待提交）
    hasCredentials: provider.type === 'ollama' || Boolean(provider.apiKey?.hasSecret) || pendingSecrets.has(provider.id),
  }
}

function toRuntimeProvider(type: AIProtocol) {
  return type
}

/** 上行（写回服务端）的数据形态：apiKey 可能是待提交的明文，也可能是 {hasSecret} 引用 */
export type AIStateWire = Omit<AIState, 'providers'> & {
  // null = 显式清除（服务端「字段缺席」表示保留原值，所以清除必须写成 null）
  providers: Array<Omit<ProviderEntry, 'apiKey'> & { apiKey?: SecretRef | string | null }>
}

/** 写回服务端时把待提交的明文密钥叠加上去（服务端据此覆盖，见 functions/_lib/secrets.js） */
export function serializeAI(ai: AIState): AIStateWire {
  if (pendingSecrets.size === 0) return ai
  return {
    ...ai,
    providers: ai.providers.map((provider) => {
      if (!pendingSecrets.has(provider.id)) return provider
      const secret = pendingSecrets.get(provider.id)
      if (secret === null) {
        // 服务端把「字段缺席」当成「保留原值」，清空必须显式发 null
        return { ...provider, apiKey: null }
      }
      // 明文只在这一次上行里出现，写入成功后 pendingSecrets 立即清空
      return { ...provider, apiKey: secret }
    }),
  }
}

function newProviderId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `p${random}`
}

function withDerived(ai: AIState): Pick<AIConfigState, 'ai' | 'aiConfig'> {
  return { ai, aiConfig: computeAIConfig(ai) }
}

export const useAIConfigStore = create<AIConfigState>()((set, get) => {
  const commit = (ai: AIState) => {
    set(withDerived(ai))
    markDirty(SECTION)
  }

  const patchProvider = (id: string, updater: (provider: ProviderEntry) => ProviderEntry) =>
    commit({
      ...get().ai,
      providers: get().ai.providers.map((provider) => (provider.id === id ? updater(provider) : provider)),
    })

  const patchModel = (providerId: string, modelId: string, updater: (model: ProviderModel) => ProviderModel) =>
    patchProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.map((model) => (model.id === modelId ? updater(model) : model)),
    }))

  return {
    ai: createEmptyAIState(),
    aiConfig: computeAIConfig(createEmptyAIState()),

    addProvider: (entry) => {
      const id = entry.id ?? newProviderId()
      const provider: ProviderEntry = {
        id,
        name: entry.name,
        type: entry.type,
        baseUrl: entry.baseUrl,
        ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
        ...(entry.catalogId ? { catalogId: entry.catalogId } : {}),
        ...(entry.modelsFetchedAt ? { modelsFetchedAt: entry.modelsFetchedAt } : {}),
        ...(entry.modelFilter ? { modelFilter: entry.modelFilter } : {}),
        models: entry.models ?? [],
      }
      const ai = get().ai
      const firstModel = provider.models.find((m) => m.enabled) ?? provider.models[0]
      commit({
        ...ai,
        providers: [...ai.providers, provider],
        // 首个服务商自动成为当前模型
        active: ai.active.providerId
          ? ai.active
          : { providerId: id, modelId: firstModel?.id ?? '' },
      })
      return id
    },

    updateProvider: (id, patch) => patchProvider(id, (provider) => ({ ...provider, ...patch })),

    deleteProvider: (id) => {
      const ai = get().ai
      const providers = ai.providers.filter((p) => p.id !== id)
      let active = ai.active
      if (active.providerId === id) {
        const next = providers[0]
        active = { providerId: next?.id ?? '', modelId: next?.models.find((m) => m.enabled)?.id ?? next?.models[0]?.id ?? '' }
      }
      pendingSecrets.delete(id)
      commit({ ...ai, providers, active })
    },

    setProviderSecret: (id, apiKey) => {
      const provider = get().ai.providers.find((p) => p.id === id)
      if (!provider) return
      if (apiKey === null) {
        pendingSecrets.set(id, null)
        patchProvider(id, (p) => {
          const { apiKey: _removed, ...rest } = p
          return rest as ProviderEntry
        })
        return
      }
      pendingSecrets.set(id, apiKey)
      patchProvider(id, (p) => ({ ...p, apiKey: { hasSecret: true } }))
    },

    setProviderModels: (id, models) => patchProvider(id, (provider) => ({ ...provider, models })),

    setProviderModelsFromIds: (id, ids, metaFor) => {
      const existing = new Map(get().ai.providers.find((p) => p.id === id)?.models.map((m) => [m.id, m]) ?? [])
      const models: ProviderModel[] = ids.map((modelId) => {
        const prev = existing.get(modelId)
        if (prev) return prev
        const meta = metaFor?.(modelId)
        return { id: modelId, enabled: true, source: 'auto', ...(meta ? { meta } : {}) }
      })
      patchProvider(id, (provider) => ({
        ...provider,
        models,
        modelsFetchedAt: new Date().toISOString(),
      }))

      // 当前模型被删除时回退到第一个可用模型
      const ai = get().ai
      const provider = ai.providers.find((p) => p.id === id)
      if (provider && ai.active.providerId === id && !models.some((m) => m.id === ai.active.modelId)) {
        commit({ ...ai, active: { providerId: id, modelId: models.find((m) => m.enabled)?.id ?? '' } })
      }
    },

    setModelMeta: (providerId, modelId, meta) =>
      patchModel(providerId, modelId, (model) => ({ ...model, meta: { ...meta, ...model.meta } })),

    setModelEnabled: (providerId, modelId, enabled) =>
      patchModel(providerId, modelId, (model) => ({ ...model, enabled })),

    setModelTemperature: (providerId, modelId, temperature) =>
      patchModel(providerId, modelId, (model) => {
        const { temperature: _old, ...rest } = model
        return temperature === undefined ? rest : { ...rest, temperature }
      }),

    addManualModel: (providerId, modelId) => {
      const id = modelId.trim()
      if (!id) return
      const provider = get().ai.providers.find((p) => p.id === providerId)
      if (!provider || provider.models.some((m) => m.id === id)) return
      patchProvider(providerId, (p) => ({
        ...p,
        models: [...p.models, { id, enabled: true, source: 'manual' }],
      }))
    },

    removeModel: (providerId, modelId) => {
      patchProvider(providerId, (provider) => ({
        ...provider,
        models: provider.models.filter((m) => m.id !== modelId),
      }))
      const ai = get().ai
      if (ai.active.providerId === providerId && ai.active.modelId === modelId) {
        const provider = ai.providers.find((p) => p.id === providerId)
        commit({
          ...ai,
          active: { providerId, modelId: provider?.models.find((m) => m.enabled)?.id ?? '' },
        })
      }
    },

    setActiveModel: (providerId, modelId) => {
      const ai = get().ai
      commit({ ...ai, active: { providerId, modelId } })
    },

    setDefaultTemperature: (temperature) => {
      const ai = get().ai
      commit({ ...ai, defaultTemperature: temperature })
    },

    setReasoningEffort: (effort) => {
      const ai = get().ai
      commit({ ...ai, reasoningEffort: effort })
    },

    replaceAI: (ai) => {
      pendingSecrets.clear()
      commit(ai)
    },

    resetAIConfig: () => {
      pendingSecrets.clear()
      commit(createEmptyAIState())
    },

    getProvider: (id) => get().ai.providers.find((p) => p.id === id),

    getActiveProvider: () => {
      const { ai } = get()
      return (
        ai.providers.find((p) => p.id === ai.active.providerId) ??
        ai.providers.find((p) => p.models.length > 0)
      )
    },

    getEnabledModels: (providerId) =>
      get().ai.providers.find((p) => p.id === providerId)?.models.filter((m) => m.enabled) ?? [],
  }
})

registerSection<AIStateWire>(
  SECTION,
  {
    getData: () => serializeAI(useAIConfigStore.getState().ai),
    setData: (data) => {
      // 服务端只回 {hasSecret}，不会有明文字符串；仍按 SecretRef 归一化以防手写 YAML 导入残留
      const providers: ProviderEntry[] = Array.isArray(data?.providers)
        ? data.providers.map((provider) => {
            const { apiKey, ...rest } = provider
            const secret: SecretRef | undefined =
              typeof apiKey === 'string'
                ? { hasSecret: apiKey.length > 0 }
                : apiKey
                  ? { hasSecret: Boolean(apiKey.hasSecret) }
                  : undefined
            return { ...rest, ...(secret ? { apiKey: secret } : {}) }
          })
        : []
      const ai: AIState = {
        providers,
        active: data?.active ?? { providerId: '', modelId: '' },
        defaultTemperature:
          typeof data?.defaultTemperature === 'number' ? data.defaultTemperature : DEFAULT_TEMPERATURE,
        ...(data?.reasoningEffort ? { reasoningEffort: data.reasoningEffort } : {}),
      }
      useAIConfigStore.setState(withDerived(ai))
    },
    debounceMs: 800,
    afterFlush: () => pendingSecrets.clear(),
  },
  { autoWrite: false }
)

/** 当前内存里待提交的明文密钥快照（导出「包含密钥」时使用） */
export function getPendingSecrets(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, secret] of pendingSecrets.entries()) {
    if (typeof secret === 'string') out[id] = secret
  }
  return out
}

/** 是否存在待提交的明文密钥（UI 用于提示「保存后生效」） */
export function hasPendingSecret(providerId: string): boolean {
  return pendingSecrets.has(providerId)
}

/** @deprecated 兼容旧调用方：直接取运行时的扁平配置 */
export type LegacyAIConfigCompat = LegacyAIConfig

// 便捷选择器
export const useAIConfig = () => useAIConfigStore((state) => state.aiConfig)
export const useAIState = () => useAIConfigStore((state) => state.ai)
export const useActiveAIProvider = () => useAIConfigStore((state) => state.getActiveProvider())
