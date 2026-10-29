// 模型目录（服务端合并 models.dev + OpenRouter + LiteLLM）：
// - 预设列表：打开向导时取一次（~15KB），模块级缓存
// - 元数据：同步模型时按 id 批量查询（只传用得到的那几十个），见 lookupModelMeta
import { useEffect, useState } from 'react'
import type { CatalogPreset } from '../../../services/ai/catalog'
import type { ProviderModelMeta } from '../../../types/ai'
import { sharedApi } from '../../../services/shared/api'

export interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  presets: CatalogPreset[]
  /** 部分数据源不可用（服务端已降级到其余来源或兜底副本） */
  degraded: boolean
}

let pending: Promise<{ presets: CatalogPreset[]; degraded: boolean }> | null = null

export function loadPresets(): Promise<{ presets: CatalogPreset[]; degraded: boolean }> {
  if (!pending) {
    pending = sharedApi
      .catalogPresets()
      .then((res) => ({ presets: Array.isArray(res.presets) ? res.presets : [], degraded: res.degraded === true }))
      .catch((error: unknown) => {
        pending = null // 失败允许下次重试
        throw error
      })
  }
  return pending
}

/** 服务端返回的紧凑字段 → 前端 meta */
function toMeta(raw: Record<string, unknown> | undefined): ProviderModelMeta | undefined {
  if (!raw) return undefined
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const meta: ProviderModelMeta = {}
  if (n(raw.c) !== undefined) meta.context = n(raw.c)
  if (n(raw.o) !== undefined) meta.output = n(raw.o)
  if (n(raw.i) !== undefined) meta.inputCost = n(raw.i)
  if (n(raw.x) !== undefined) meta.outputCost = n(raw.x)
  if (typeof raw.r === 'boolean') meta.reasoning = raw.r
  if (typeof raw.t === 'boolean') meta.temperature = raw.t
  if (typeof raw.e === 'boolean') meta.reasoningEffort = raw.e
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** 批量查模型元数据；查不到的 id 不出现在结果里。失败时返回空表（元数据是锦上添花，不阻断同步） */
export async function lookupModelMeta(
  ids: string[],
  catalogId?: string
): Promise<Record<string, { meta?: ProviderModelMeta; name?: string }>> {
  if (ids.length === 0) return {}
  try {
    const res = await sharedApi.catalogLookup(ids, catalogId)
    const out: Record<string, { meta?: ProviderModelMeta; name?: string }> = {}
    for (const [id, raw] of Object.entries(res.models ?? {})) {
      const record = raw as Record<string, unknown>
      out[id] = { meta: toMeta(record), ...(typeof record.n === 'string' ? { name: record.n } : {}) }
    }
    return out
  } catch {
    return {}
  }
}

export function useCatalog(enabled = true): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'idle', presets: [], degraded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }))
    loadPresets().then(
      ({ presets, degraded }) => {
        if (!cancelled) setState({ status: 'ready', presets, degraded })
      },
      () => {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }))
      }
    )
    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}
