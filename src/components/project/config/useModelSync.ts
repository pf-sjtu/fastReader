// 浏览器侧的模型自动同步：拉 /models → 经 /api/ai 实测 → models.dev 补元数据 → 写回 store
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAIConfigStore } from '../../../stores/ai-config'
import type { ProviderEntry } from '../../../types/ai'
import { classifyProbe, isModelListStale, probeRequest, syncProviderModels, type ProbeResult } from '../../../services/ai/modelSync'
import { flushSection } from '../../../services/shared/sharedState'
import { describeFetchError, fetchProviderModelIds, reconcileActiveModel } from './provider-utils'
import { lookupModelMeta } from './useCatalog'

/** 经同源代理（服务端注入密钥）对单个模型发一次极小请求 */
async function probeViaProxy(provider: ProviderEntry, modelId: string): Promise<ProbeResult> {
  // Ollama 本机直连：能列出来就能用，不再逐个实测
  if (provider.type === 'ollama') return { status: 'ok' }
  const { path, body } = probeRequest(provider.type, modelId)
  const url = new URL('/api/ai', window.location.origin)
  url.searchParams.set('path', path)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Provider-Id': provider.id },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return classifyProbe(response.status, await response.text())
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : String(error) }
  } finally {
    window.clearTimeout(timer)
  }
}

export interface ModelSyncApi {
  /** 正在同步的服务商 id */
  syncing: ReadonlySet<string>
  /** 同步单个服务商；quiet=true 时只在失败时提示 */
  sync: (providerId: string, options?: { quiet?: boolean }) => Promise<void>
}

export function useModelSync(): ModelSyncApi {
  const { t } = useTranslation()
  const [syncing, setSyncing] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(new Set<string>())

  const sync = useCallback(
    async (providerId: string, options: { quiet?: boolean } = {}) => {
      if (inFlight.current.has(providerId)) return
      const initial = useAIConfigStore.getState().getProvider(providerId)
      if (!initial) return

      inFlight.current.add(providerId)
      setSyncing(new Set(inFlight.current))
      try {
        // 实测走 /api/ai，服务端需要已保存的密钥：本地有待提交的新密钥时先写回
        await flushSection('ai').catch(() => undefined)

        const result = await syncProviderModels(initial, {
          listModels: () => fetchProviderModelIds({ providerId, type: initial.type, baseUrl: initial.baseUrl }),
          probe: (id) => probeViaProxy(initial, id),
          lookupMeta: (ids) => lookupModelMeta(ids, initial.catalogId),
        })

        const store = useAIConfigStore.getState()
        if (!store.getProvider(providerId)) return // 同步期间被删除
        store.updateProvider(providerId, { models: result.models, modelsFetchedAt: new Date().toISOString() })
        reconcileActiveModel()

        if (!options.quiet || result.added > 0 || result.removed > 0) {
          const usable = result.models.filter((m) => m.enabled).length
          toast.success(t('aiProvider.sync.done', { name: initial.name, usable, total: result.kept }), {
            description: [
              t('aiProvider.refreshDiff', { added: result.added, removed: result.removed }),
              result.disabled.length > 0
                ? t('aiProvider.sync.disabled', {
                    list: result.disabled.map((d) => `${d.id}（${d.reason}）`).join('、'),
                  })
                : '',
            ]
              .filter(Boolean)
              .join('；'),
          })
        }
      } catch (error) {
        toast.error(t('aiProvider.refreshFailed', { name: initial.name }), { description: describeFetchError(error, t) })
      } finally {
        inFlight.current.delete(providerId)
        setSyncing(new Set(inFlight.current))
      }
    },
    [t]
  )

  return { syncing, sync }
}

/**
 * 打开服务商面板时：模型列表超过 TTL（7 天）的服务商在后台静默刷新一次。
 * 同一会话每个服务商最多自动刷新一次，避免反复实测耗额度。
 */
export function useAutoRefreshStaleProviders(sync: ModelSyncApi['sync']): void {
  const providers = useAIConfigStore((s) => s.ai.providers)
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    for (const provider of providers) {
      if (attempted.current.has(provider.id)) continue
      if (provider.type !== 'ollama' && !provider.apiKey?.hasSecret) continue
      if (!isModelListStale(provider)) continue
      attempted.current.add(provider.id)
      void sync(provider.id, { quiet: true })
    }
  }, [providers, sync])
}
