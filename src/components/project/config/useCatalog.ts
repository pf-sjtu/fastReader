// models.dev 目录：仅在服务商面板真正打开时才拉取（~140KB gz），模块级缓存，同一会话只请求一次
import { useEffect, useState } from 'react'
import type { Catalog } from '../../../services/ai/catalog'
import { sharedApi } from '../../../services/shared/api'

/** 目录相关的匹配函数单独成块，随目录一起懒加载 */
export type CatalogModule = typeof import('../../../services/ai/catalog')

export interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  catalog: Catalog | null
  lib: CatalogModule | null
  /** 服务端回退到了旧副本（上游 models.dev 不可用） */
  degraded: boolean
}

interface Loaded {
  catalog: Catalog
  lib: CatalogModule
  degraded: boolean
}

let pending: Promise<Loaded> | null = null

function toCatalog(raw: unknown): { catalog: Catalog; degraded: boolean } {
  const body = (raw ?? {}) as { providers?: unknown; degraded?: unknown }
  const providers =
    body.providers && typeof body.providers === 'object' ? (body.providers as Catalog['providers']) : {}
  return { catalog: { providers }, degraded: body.degraded === true }
}

export function loadCatalog(): Promise<Loaded> {
  if (!pending) {
    pending = Promise.all([import('../../../services/ai/catalog'), sharedApi.catalog()])
      .then(([lib, raw]) => ({ lib, ...toCatalog(raw) }))
      .catch((error: unknown) => {
        pending = null // 失败允许下次重试
        throw error
      })
  }
  return pending
}

export function useCatalog(enabled = true): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'idle', catalog: null, lib: null, degraded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }))
    loadCatalog().then(
      ({ catalog, lib, degraded }) => {
        if (!cancelled) setState({ status: 'ready', catalog, lib, degraded })
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
