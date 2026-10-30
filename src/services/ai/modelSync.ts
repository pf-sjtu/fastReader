/**
 * 服务商模型自动同步：配好地址 + 密钥后，模型列表不再手工维护。
 *
 * 流程：
 *   1. 拉取 /models（服务端用保存的密钥）
 *   2. 过滤：非对话模型（向量/语音/图像/审核…）、带日期的快照（保留别名即可）、服务商级规则（include/exclude）
 *   3. 实测：经 /api/ai 发一次极小请求，把 403/404/429/空 choices 的模型标成不可用（附原因），不让它们出现在下拉里
 *   4. 补元数据：models.dev 的上下文、价格、推理标记
 *   5. 合并：保留用户对已有模型的设置（启用开关、温度、label），新模型按实测结果启用
 *
 * 纯函数 + 注入网络层：浏览器 UI 与运维脚本走同一套逻辑。
 */
import type { ProviderEntry, ProviderModel, ProviderModelMeta } from '../../types/ai'

/** 实测结果 */
export type ProbeStatus = 'ok' | 'denied' | 'not_found' | 'rate_limited' | 'empty' | 'error'

export interface ProbeResult {
  status: ProbeStatus
  /** 人类可读原因（写进模型 label 后缀，方便用户理解为什么被停用） */
  reason?: string
}

/** 服务商级过滤规则（存在 ProviderEntry.modelFilter 上，可在 UI 里改） */
export interface ModelFilter {
  /** 只保留匹配任一前缀/正则的模型；空 = 不限制 */
  include?: string[]
  /** 排除匹配任一前缀/正则的模型 */
  exclude?: string[]
}

/** 名字里带这些词的基本都不是对话模型 */
const NON_CHAT_PATTERNS = [
  /embed/i, /embedding/i, /rerank/i, /moderation/i, /whisper/i, /\btts\b/i, /-tts/i, /audio/i,
  /realtime/i, /transcribe/i, /speech/i, /dall-?e/i, /\bimage\b/i, /-image/i, /gpt-image/i, /imagen/i,
  /\bsora\b/i, /\bveo\b/i, /video/i, /vision-exp/i, /-u1\.5/i, /computer-use/i, /search-preview/i,
  /babbage/i, /davinci/i, /-instruct(-|$)/i, /\bomni-moderation\b/i, /aqa$/i, /learnlm/i,
]

/** OpenAI 等会同时列出别名与带日期的快照（gpt-4o 与 gpt-4o-2024-08-06）：保留别名即可 */
const DATED_SNAPSHOT = /-(20\d{2}-\d{2}-\d{2}|20\d{6}|\d{4})$/

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_PATTERNS.some((re) => re.test(id))
}

function matchesRule(id: string, rule: string): boolean {
  if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
    const last = rule.lastIndexOf('/')
    try {
      return new RegExp(rule.slice(1, last), rule.slice(last + 1)).test(id)
    } catch {
      return false
    }
  }
  return id.toLowerCase().startsWith(rule.toLowerCase())
}

/**
 * 从原始 /models 列表筛出值得启用的对话模型。
 * 快照只在「同名别名也存在」时才去掉，避免把只有快照的服务商清空。
 */
export function filterModelIds(ids: string[], filter: ModelFilter = {}): string[] {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))]
  const set = new Set(unique)
  return unique.filter((id) => {
    if (filter.include?.length && !filter.include.some((r) => matchesRule(id, r))) return false
    if (filter.exclude?.some((r) => matchesRule(id, r))) return false
    if (!isChatModelId(id)) return false
    const alias = id.replace(DATED_SNAPSHOT, '')
    if (alias !== id && set.has(alias)) return false
    return true
  })
}

/** HTTP 状态 → 实测结论 */
export function classifyProbe(status: number, body: string): ProbeResult {
  const text = body.slice(0, 300)
  if (status >= 200 && status < 300) {
    return text.includes('"choices":[]') ? { status: 'empty', reason: '返回空结果' } : { status: 'ok' }
  }
  if (status === 401 || status === 403) return { status: 'denied', reason: '当前套餐无权限' }
  // OpenAI：gpt-5-pro / codex 等只在 /v1/responses 提供，/chat/completions 用不了（并非下线）
  if (/only supported in v1\/responses|not supported in v1\/chat\/completions/i.test(text)) {
    return { status: 'not_found', reason: '仅支持 Responses 接口' }
  }
  if (/deprecat/i.test(text)) return { status: 'not_found', reason: '已弃用' }
  if (status === 404 || /model_not_found|not found|unknown provider/i.test(text)) {
    return { status: 'not_found', reason: '服务商已下线该模型' }
  }
  if (status === 429) return { status: 'rate_limited', reason: '当前限流' }
  return { status: 'error', reason: `HTTP ${status}` }
}

/** 实测结论 → 是否默认启用。限流是暂时的：保留启用，下次同步再看 */
export function shouldEnable(probe: ProbeResult | undefined): boolean {
  return !probe || probe.status === 'ok' || probe.status === 'rate_limited'
}

export interface SyncDeps {
  /** 拉取服务商的模型 id 列表 */
  listModels: () => Promise<string[]>
  /** 对单个模型发一次极小请求；不提供则跳过实测 */
  probe?: (modelId: string) => Promise<ProbeResult>
  /** 批量查元数据（服务端合并多数据源）；不提供则不补元数据 */
  lookupMeta?: (ids: string[]) => Promise<Record<string, { meta?: ProviderModelMeta; name?: string }>>
  /** 实测并发；上游常有 rpm 限制，默认 4 */
  concurrency?: number
  /** 实测上限：模型很多的聚合网关只测前 N 个，其余按名字过滤结果启用 */
  maxProbes?: number
}

export interface SyncResult {
  models: ProviderModel[]
  fetched: number
  kept: number
  added: number
  removed: number
  disabled: Array<{ id: string; reason: string }>
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

const AUTO_DISABLED_SUFFIX = /（[^（）]*，已停用）$/

/** 去掉同步时附加的状态后缀，拿回用户自己的 label */
function baseLabel(model: ProviderModel): string | undefined {
  return model.label?.replace(AUTO_DISABLED_SUFFIX, '') || undefined
}

/** 这个「停用」是不是上一次同步自动加的（而非用户手动关掉的） */
function wasAutoDisabled(model: ProviderModel | undefined): boolean {
  return !!model && !model.enabled && AUTO_DISABLED_SUFFIX.test(model.label ?? '')
}

/**
 * 同步一个服务商的模型列表。
 *
 * 合并规则：
 *  - 手动添加（source=manual）的模型始终保留，不实测、不改动
 *  - 已有的自动模型：上游还在 → 保留用户设置；实测失败 → 停用并注明原因；上游已移除 → 删除
 *  - 新出现的模型：按实测结果启用
 */
export async function syncProviderModels(provider: ProviderEntry, deps: SyncDeps): Promise<SyncResult> {
  const raw = await deps.listModels()
  const filter = provider.modelFilter
  const candidates = filterModelIds(raw, filter)

  const existing = new Map(provider.models.map((m) => [m.id, m]))
  const manual = provider.models.filter((m) => m.source === 'manual' && !candidates.includes(m.id))

  const toProbe = deps.probe ? candidates.slice(0, deps.maxProbes ?? 40) : []
  const probes = new Map<string, ProbeResult>()
  if (deps.probe && toProbe.length > 0) {
    const results = await mapLimit(toProbe, deps.concurrency ?? 4, async (id) => {
      try {
        return [id, await deps.probe!(id)] as const
      } catch (error) {
        return [id, { status: 'error', reason: error instanceof Error ? error.message : String(error) }] as const
      }
    })
    for (const [id, r] of results) probes.set(id, r)
  }

  const metas = deps.lookupMeta ? await deps.lookupMeta(candidates).catch(() => ({})) : {}

  const disabled: SyncResult['disabled'] = []
  let added = 0
  const synced: ProviderModel[] = candidates.map((id) => {
    const prev = existing.get(id)
    const probe = probes.get(id)
    const usable = shouldEnable(probe)
    const found = (metas as Record<string, { meta?: ProviderModelMeta; name?: string }>)[id]
    const meta = found?.meta
    if (!prev) added++
    if (!usable && probe) disabled.push({ id, reason: probe.reason ?? probe.status })

    // 用户改过的 label 优先；否则用目录里的展示名（如 GPT-4o mini）
    const label = baseLabel(prev ?? ({ id } as ProviderModel)) ?? found?.name
    const reasonSuffix = !usable && probe?.reason ? `（${probe.reason}，已停用）` : ''
    return {
      id,
      // 上游还在的已有模型：尊重用户手动的启用开关；上次同步自动停用的恢复后重新启用；实测不可用则停用
      enabled: usable ? (prev && !wasAutoDisabled(prev) ? prev.enabled : true) : false,
      source: 'auto',
      ...(label || reasonSuffix ? { label: `${label ?? id}${reasonSuffix}` } : {}),
      ...(prev?.temperature !== undefined ? { temperature: prev.temperature } : {}),
      ...(meta || prev?.meta ? { meta: { ...meta, ...prev?.meta } } : {}),
    }
  })

  const removed = provider.models.filter((m) => m.source !== 'manual' && !candidates.includes(m.id)).length
  return {
    models: [...synced, ...manual],
    fetched: raw.length,
    kept: synced.length,
    added,
    removed,
    disabled,
  }
}

/** 服务商的模型多久没同步就自动刷新（打开设置页时触发） */
export const MODEL_SYNC_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function isModelListStale(provider: Pick<ProviderEntry, 'modelsFetchedAt'>, now = Date.now()): boolean {
  if (!provider.modelsFetchedAt) return true
  const at = Date.parse(provider.modelsFetchedAt)
  return !Number.isFinite(at) || now - at > MODEL_SYNC_TTL_MS
}

/** 构造实测请求体（OpenAI 兼容 / Anthropic）；max_tokens 给足，避免推理模型思考阶段被截成空内容 */
export function probeRequest(type: ProviderEntry['type'], modelId: string): { path: string; body: unknown } {
  if (type === 'anthropic') {
    return { path: 'messages', body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] } }
  }
  if (type === 'gemini') {
    return {
      path: `models/${encodeURIComponent(modelId)}:generateContent`,
      body: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 16 } },
    }
  }
  // 不带输出上限：OpenAI 新模型（gpt-5 / o 系列）拒绝 max_tokens，只认 max_completion_tokens，
  // 而不少兼容网关又不认后者。正式处理请求本来就不传上限，实测也保持一致，避免误判为不可用。
  return {
    path: 'chat/completions',
    body: { model: modelId, messages: [{ role: 'user', content: 'ping' }] },
  }
}
