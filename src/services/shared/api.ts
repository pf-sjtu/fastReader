/**
 * 共享状态的 HTTP 客户端。
 *
 * 所有配置/状态都在服务端（Cloudflare KV），凭据由服务端注入，
 * 浏览器只拿得到 `{ hasSecret: true }` 这类脱敏视图。
 */

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class SharedApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'SharedApiError'
    this.status = status
    this.code = code
  }
}

export interface SectionSnapshot<T = unknown> {
  rev: number
  updatedAt: string
  data: T
}

/** 409：服务端已前进，带上最新值供三方合并 */
export class ConflictError extends Error {
  rev: number
  updatedAt: string
  data: unknown
  constructor(rev: number, updatedAt: string, data: unknown) {
    super('conflict')
    this.name = 'ConflictError'
    this.rev = rev
    this.updatedAt = updatedAt
    this.data = data
  }
}

export interface StateResponse {
  initialized: boolean
  sections: Record<string, SectionSnapshot>
  missing: string[]
}

/** 会话失效（401）时广播，AuthGate 据此退回登录页，避免用户继续编辑却全部写不进去 */
export const SESSION_EXPIRED_EVENT = 'fastreader:session-expired'

function notifySessionExpired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

async function parseError(response: Response): Promise<never> {
  let body: { error?: string; message?: string } = {}
  try {
    body = await response.json()
  } catch {
    // 非 JSON 错误
  }
  if (response.status === 401) {
    notifySessionExpired()
    throw new UnauthorizedError()
  }
  throw new SharedApiError(response.status, body.message || body.error || `HTTP ${response.status}`, body.error)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin' })
  } catch (error) {
    throw new SharedApiError(0, error instanceof Error ? error.message : 'network error', 'network')
  }
  if (!response.ok) await parseError(response)
  return response
}

export const sharedApi = {
  async me(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
      return response.ok
    } catch {
      return false
    }
  },

  async login(password: string): Promise<void> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new SharedApiError(response.status, body.error || 'login_failed', body.error)
    }
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  },

  async getState(): Promise<StateResponse> {
    const response = await request('/api/state', { headers: { Accept: 'application/json' } })
    return (await response.json()) as StateResponse
  },

  /** 写入某节；`rev` 为上次同步到的版本，0 表示「新建」 */
  async putSection<T>(
    section: string,
    data: T,
    rev: number,
    options: { keepalive?: boolean } = {}
  ): Promise<{ rev: number; updatedAt: string }> {
    const body = JSON.stringify({ data })
    let response: Response
    try {
      response = await fetch(`/api/state/${section}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { ...JSON_HEADERS, 'If-Match': String(rev) },
        body,
        // 关页/切走时浏览器会取消普通请求；keepalive 有 64KB 上限，超了只能放弃该特性
        keepalive: options.keepalive === true && body.length < 60_000,
      })
    } catch (error) {
      throw new SharedApiError(0, error instanceof Error ? error.message : 'network error', 'network')
    }

    if (response.status === 409) {
      const body = await response.json()
      throw new ConflictError(body.rev ?? 0, body.updatedAt ?? '', body.data ?? {})
    }
    if (!response.ok) await parseError(response)
    return await response.json()
  },

  async appendSection<T>(section: string, patch: unknown): Promise<SectionSnapshot<T>> {
    const response = await request(`/api/state/${section}/append`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ patch }),
    })
    return (await response.json()) as SectionSnapshot<T>
  },

  /** 服务商预设（~15KB）；元数据请用 catalogLookup 按需查询 */
  async catalogPresets(): Promise<{ presets: Array<{ id: string; name: string; api: string; modelCount: number }>; degraded?: boolean }> {
    const response = await request('/api/catalog', { headers: { Accept: 'application/json' } })
    return await response.json()
  },

  /** 只查这些模型的元数据（服务端合并 models.dev + OpenRouter + LiteLLM） */
  async catalogLookup(ids: string[], catalogId?: string): Promise<{ models: Record<string, unknown>; degraded?: boolean }> {
    const response = await request('/api/catalog/lookup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids, ...(catalogId ? { catalogId } : {}) }),
    })
    return await response.json()
  },

  async providerModels(body: {
    providerId?: string
    type?: string
    baseUrl?: string
    apiKey?: string
  }): Promise<{ models: string[]; count: number }> {
    const response = await request('/api/providers/models', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
    return await response.json()
  },
}
