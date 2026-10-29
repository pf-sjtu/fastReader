// 服务商面板 / 向导共用的纯函数与小工具（不含 React 组件）
import type { TFunction } from 'i18next'
import type { AIProtocol, ProviderModel, ProviderModelMeta } from '../../../types/ai'
import { SharedApiError, sharedApi } from '../../../services/shared/api'
import { flushSection } from '../../../services/shared/sharedState'
import { hasPendingSecret, useAIConfigStore } from '../../../stores/ai-config'

/** 温度允许范围（OpenAI / Gemini 均接受 0–2） */
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2

/** 向导第一步的固定入口（目录加载失败时也可用） */
export interface FixedPreset {
  key: AIProtocol
  name: string
  type: AIProtocol
  baseUrl: string
  catalogId?: string
}

export const FIXED_PRESETS: FixedPreset[] = [
  { key: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', catalogId: 'openai' },
  { key: 'gemini', name: 'Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', catalogId: 'google' },
  { key: 'ollama', name: 'Ollama', type: 'ollama', baseUrl: 'http://localhost:11434' },
]

/** 协议默认地址（与 services/ai/catalog 的 defaultBaseUrlFor 一致；不引目录模块以保持懒加载） */
export function defaultBaseUrlForProtocol(type: AIProtocol): string {
  return FIXED_PRESETS.find((p) => p.type === type)?.baseUrl ?? FIXED_PRESETS[0].baseUrl
}

/** 由地址推一个默认名称：api.deepseek.com → api.deepseek.com */
export function nameFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host
  } catch {
    return baseUrl.trim()
  }
}

/** 模型展示名（与 services/ai/catalog 的 modelLabel 一致；这里不引目录模块，保持其懒加载） */
export function modelLabelOf(model: Pick<ProviderModel, 'id' | 'label'>): string {
  return model.label || model.id
}

/** 上下文窗口：128000 → 128K，1048576 → 1M */
export function formatContext(tokens: number | undefined): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return null
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

/** 单价（USD / 1M tokens）：去掉多余小数 */
export function formatCost(cost: number): string {
  if (cost === 0) return '0'
  if (cost < 0.01) return cost.toPrecision(2)
  return String(Math.round(cost * 100) / 100)
}

/** 有输入/输出价格时返回 [输入, 输出]，否则 null（显示「未计价」） */
export function priceOf(meta: ProviderModelMeta | undefined): [string, string] | null {
  if (typeof meta?.inputCost !== 'number' || typeof meta?.outputCost !== 'number') return null
  return [formatCost(meta.inputCost), formatCost(meta.outputCost)]
}

/** 手填模型 ID：逗号 / 换行 / 空白分隔，去重保序 */
export function parseModelIds(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,，;；]+/)) {
    const id = part.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/** 解析温度输入；空串 → undefined；非法 → null（保持原值） */
export function parseTemperatureInput(raw: string): number | undefined | null {
  const text = raw.trim()
  if (!text) return undefined
  const v = Number(text)
  if (!Number.isFinite(v)) return null
  return Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, Math.round(v * 100) / 100))
}

export type BaseUrlIssue = 'required' | 'invalid' | 'https' | null

/** 非 Ollama 的地址要过服务端代理：只接受 https */
export function checkBaseUrl(type: AIProtocol, baseUrl: string): BaseUrlIssue {
  const text = baseUrl.trim()
  if (!text) return 'required'
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return 'invalid'
  }
  if (type === 'ollama') return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'invalid'
  return url.protocol === 'https:' ? null : 'https'
}

/**
 * 刷新模型时合并：保留已有模型（含用户设置），移除上游已下架的自动模型，手动模型不动。
 * 已有模型时新出现的模型默认停用，避免一次性塞满「当前模型」下拉；首次获取则全部启用。
 */
export function mergeFetchedModels(
  existing: ProviderModel[],
  fetchedIds: string[]
): { models: ProviderModel[]; added: number; removed: number } {
  const fetched = new Set(fetchedIds)
  const kept = existing.filter((m) => m.source === 'manual' || fetched.has(m.id))
  const known = new Set(kept.map((m) => m.id))
  const enableNew = existing.length === 0
  const fresh: ProviderModel[] = fetchedIds
    .filter((id) => !known.has(id))
    .map((id) => ({ id, enabled: enableNew, source: 'auto' }))
  return { models: [...kept, ...fresh], added: fresh.length, removed: existing.length - kept.length }
}

/** 当前模型失效（被删 / 停用 / 服务商被删）时回退到第一个可用模型 */
export function reconcileActiveModel(): void {
  const { ai, setActiveModel } = useAIConfigStore.getState()
  const current = ai.providers.find((p) => p.id === ai.active.providerId)
  if (current?.models.some((m) => m.id === ai.active.modelId && m.enabled)) return
  const sameProvider = current?.models.find((m) => m.enabled)
  if (current && sameProvider) {
    setActiveModel(current.id, sameProvider.id)
    return
  }
  for (const provider of ai.providers) {
    const model = provider.models.find((m) => m.enabled)
    if (model) {
      setActiveModel(provider.id, model.id)
      return
    }
  }
  if (ai.active.providerId || ai.active.modelId) setActiveModel('', '')
}

export interface FetchModelsInput {
  /** 已保存的服务商：服务端用它找已存储的密钥 */
  providerId?: string
  type: AIProtocol
  baseUrl: string
  /** 新输入的明文密钥（仅本次请求使用） */
  apiKey?: string
}

/** Ollama 浏览器直连时的错误（与服务端错误区分，便于提示） */
export class OllamaUnreachableError extends Error {
  url: string
  constructor(url: string) {
    super(`ollama unreachable: ${url}`)
    this.name = 'OllamaUnreachableError'
    this.url = url
  }
}

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.trim().replace(/\/+$/, '')}/api/tags`
  let data: unknown
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data = await response.json()
  } catch {
    throw new OllamaUnreachableError(url)
  }
  const list = (data as { models?: unknown })?.models
  if (!Array.isArray(list)) return []
  return list
    .map((item) => (item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
}

/** 拉取模型 ID：Ollama 浏览器直连，其余走服务端 /api/providers/models */
export async function fetchProviderModelIds(input: FetchModelsInput): Promise<string[]> {
  if (input.type === 'ollama') return fetchOllamaModels(input.baseUrl)
  // 刚改过的密钥还在本地待提交：先写回，服务端才能用上
  if (input.providerId && !input.apiKey && hasPendingSecret(input.providerId)) {
    await flushSection('ai')
  }
  const result = await sharedApi.providerModels({
    ...(input.providerId ? { providerId: input.providerId } : {}),
    type: input.type,
    baseUrl: input.baseUrl.trim(),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  })
  return Array.isArray(result?.models) ? result.models.filter((id) => typeof id === 'string' && id) : []
}

const KNOWN_ERROR_CODES = ['invalid_base_url', 'missing_base_url', 'unknown_provider', 'network'] as const

/** 把拉取模型的错误翻成给人看的一句话 */
export function describeFetchError(error: unknown, t: TFunction): string {
  if (error instanceof OllamaUnreachableError) return t('aiProvider.wizard.ollamaUnreachable', { url: error.url })
  if (error instanceof SharedApiError) {
    if (error.status === 401) return t('aiProvider.errors.unauthorized')
    const code = KNOWN_ERROR_CODES.find((c) => c === error.code)
    if (code) return t(`aiProvider.errors.${code}`)
    return error.message
  }
  if (error instanceof Error && error.message === 'unauthorized') return t('aiProvider.errors.unauthorized')
  return error instanceof Error ? error.message : String(error)
}
