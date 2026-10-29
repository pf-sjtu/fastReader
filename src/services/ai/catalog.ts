/**
 * models.dev 目录的本地匹配逻辑。
 *
 * 目录由服务端 `/api/catalog` 精简下发，结构：
 * `{ providers: { [providerId]: { name, api, models: { [modelId]: { n, c, o, i, x, r, t } } } } }`
 * 字段：n=显示名 c=上下文 o=输出上限 i=输入价 x=输出价 r=推理 t=支持温度（价格单位 USD/1M tokens）。
 */
import type { AIProtocol, ProviderEntry, ProviderModel, ProviderModelMeta } from '../../types/ai'

export interface CatalogModel {
  n?: string
  c?: number
  o?: number
  i?: number
  x?: number
  r?: boolean
  t?: boolean
}

export interface CatalogProvider {
  name?: string
  api?: string
  models: Record<string, CatalogModel>
}

export interface Catalog {
  providers: Record<string, CatalogProvider>
}

export const EMPTY_CATALOG: Catalog = { providers: {} }

/** 去掉供应商前缀与常见渠道后缀：`openai/gpt-5` → `gpt-5`，`grok-4.5:online` → `grok-4.5` */
export function normalizeModelId(raw: string): string {
  let id = (raw || '').trim().toLowerCase()
  // 目录里常见 `vendor/model` 写法，取最后一段更稳定
  const slash = id.lastIndexOf('/')
  if (slash !== -1 && slash < id.length - 1) id = id.slice(slash + 1)
  // 网关加的后缀：:online / :free / :beta / -latest 等
  id = id.replace(/(:(online|free|beta|thinking|reasoning|latest|extended))+$/g, '')
  return id
}

/** 从 baseUrl 猜 models.dev 的 provider id（hostname → 目录内 api 主机匹配） */
export function guessCatalogProviderId(catalog: Catalog, baseUrl: string): string | undefined {
  let host = ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`
    host = new URL(withProtocol).hostname.toLowerCase()
  } catch {
    return undefined
  }
  if (!host) return undefined

  // 目录里 api 字段可能是 undefined（官方默认端点），先按精确 host 匹配
  for (const [id, provider] of Object.entries(catalog.providers)) {
    if (!provider.api) continue
    try {
      if (new URL(provider.api).hostname.toLowerCase() === host) return id
    } catch {
      // ignore
    }
  }
  return undefined
}

/** 官方服务商 id：价格/上下文优先取这些来源，避免渠道价污染 */
const OFFICIAL_PROVIDERS: Record<string, string[]> = {
  openai: ['openai'],
  gemini: ['google', 'google-vertex'],
  ollama: []
}

function providerCandidates(
  catalog: Catalog,
  provider: Pick<ProviderEntry, 'type' | 'baseUrl' | 'catalogId'>
): string[] {
  const ids: string[] = []
  if (provider.catalogId && catalog.providers[provider.catalogId]) ids.push(provider.catalogId)
  const guessed = guessCatalogProviderId(catalog, provider.baseUrl)
  if (guessed && !ids.includes(guessed)) ids.push(guessed)
  for (const id of OFFICIAL_PROVIDERS[provider.type] ?? []) {
    if (catalog.providers[id] && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function toMeta(model: CatalogModel): ProviderModelMeta {
  const meta: ProviderModelMeta = {}
  if (typeof model.c === 'number') meta.context = model.c
  if (typeof model.o === 'number') meta.output = model.o
  if (typeof model.i === 'number') meta.inputCost = model.i
  if (typeof model.x === 'number') meta.outputCost = model.x
  if (typeof model.r === 'boolean') meta.reasoning = model.r
  if (typeof model.t === 'boolean') meta.temperature = model.t
  return meta
}

/**
 * 为单个模型找元数据。
 * 顺序：所属服务商条目内的精确 id → 该服务商的归一化 id → 全目录归一化 id（官方 provider 优先）。
 */
export function findModelMeta(
  catalog: Catalog,
  provider: Pick<ProviderEntry, 'type' | 'baseUrl' | 'catalogId'>,
  modelId: string
): ProviderModelMeta | undefined {
  const providerIds = providerCandidates(catalog, provider)
  const target = normalizeModelId(modelId)

  for (const pid of providerIds) {
    const models = catalog.providers[pid]?.models ?? {}
    if (models[modelId]) return toMeta(models[modelId])
    const hit = Object.keys(models).find((key) => normalizeModelId(key) === target)
    if (hit) return toMeta(models[hit])
  }

  // 全目录兜底：官方 provider 优先，其余按 providerId 字典序保证结果稳定
  const official = new Set(Object.values(OFFICIAL_PROVIDERS).flat())
  const pids = Object.keys(catalog.providers).sort((a, b) => {
    const ao = official.has(a) ? 0 : 1
    const bo = official.has(b) ? 0 : 1
    return ao - bo || a.localeCompare(b)
  })
  for (const pid of pids) {
    const models = catalog.providers[pid]?.models
    if (!models) continue
    for (const key of Object.keys(models)) {
      if (normalizeModelId(key) === target) return toMeta(models[key])
    }
  }

  return undefined
}

/** 为服务商下所有模型补齐元数据（保留已有 meta，不覆盖用户显式设置） */
export function enrichProviderMeta(catalog: Catalog, provider: ProviderEntry): ProviderEntry {
  if (Object.keys(catalog.providers).length === 0) return provider
  return {
    ...provider,
    models: provider.models.map((model) => {
      const meta = findModelMeta(catalog, provider, model.id)
      if (!meta) return model
      return {
        ...model,
        label: model.label ?? catalog.providers[providerCandidates(catalog, provider)[0]]?.models?.[model.id]?.n ?? model.label,
        meta: { ...meta, ...model.meta }
      }
    })
  }
}

/** 目录里可作「预设」的服务商（带 api 端点，可直接 OpenAI 兼容接入） */
export interface CatalogPreset {
  id: string
  name: string
  api: string
  modelCount: number
}

export function listPresets(catalog: Catalog): CatalogPreset[] {
  return Object.entries(catalog.providers)
    .filter(([, p]) => typeof p.api === 'string' && p.api.length > 0)
    .map(([id, p]) => ({
      id,
      name: p.name || id,
      api: p.api as string,
      modelCount: Object.keys(p.models ?? {}).length
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 协议默认 baseUrl（用于「自定义服务商」表单的占位与预设缺失时的兜底） */
export function defaultBaseUrlFor(type: AIProtocol): string {
  switch (type) {
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta'
    case 'ollama':
      return 'http://localhost:11434'
    default:
      return 'https://api.openai.com/v1'
  }
}

/** 由模型 id 生成展示名（元数据缺失时的兜底） */
export function modelLabel(model: ProviderModel): string {
  return model.label || model.id
}
