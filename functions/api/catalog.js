// /api/catalog —— 下发 models.dev 的精简目录
//
// 上游 api.json 约 5.9MB / 233 家 / 8900+ 模型；精简为 {name, api, models:{id:{n,c,o,i,x,r,t}}}
// 约 960KB（gzip ~140KB）。用 Cache API 缓存 24h（不占 KV 写额度），
// 上游失败时回退 KV 里的上一次副本（仅成功时写一次）。
import { getKv } from '../_lib/kv.js'
import { jsonResponse } from '../_lib/origin.js'

const CATALOG_URL = 'https://models.dev/api.json'
const CACHE_KEY = 'https://fastreader.internal/catalog-v1'
const CACHE_TTL_SECONDS = 60 * 60 * 24
const KV_FALLBACK_KEY = 'catalog:fallback'
const MAX_MODELS_PER_PROVIDER = 400

function compact(raw) {
  const providers = {}
  for (const [id, provider] of Object.entries(raw ?? {})) {
    if (!provider || typeof provider !== 'object') continue
    const models = {}
    const entries = Object.entries(provider.models ?? {}).slice(0, MAX_MODELS_PER_PROVIDER)
    for (const [modelId, model] of entries) {
      if (!model || typeof model !== 'object') continue
      const limit = model.limit ?? {}
      const cost = model.cost ?? {}
      const item = {}
      if (typeof model.name === 'string') item.n = model.name
      if (typeof limit.context === 'number') item.c = limit.context
      if (typeof limit.output === 'number') item.o = limit.output
      if (typeof cost.input === 'number') item.i = cost.input
      if (typeof cost.output === 'number') item.x = cost.output
      if (typeof model.reasoning === 'boolean') item.r = model.reasoning
      if (typeof model.temperature === 'boolean') item.t = model.temperature
      models[modelId] = item
    }
    providers[id] = {
      name: typeof provider.name === 'string' ? provider.name : id,
      ...(typeof provider.api === 'string' ? { api: provider.api } : {}),
      models,
    }
  }
  return { providers, generatedAt: new Date().toISOString() }
}

async function readCache() {
  try {
    if (typeof caches === 'undefined' || !caches.default) return null
    const res = await caches.default.match(CACHE_KEY)
    if (!res) return null
    return await res.json()
  } catch {
    return null
  }
}

async function writeCache(catalog) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return
    await caches.default.put(
      CACHE_KEY,
      new Response(JSON.stringify(catalog), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      })
    )
  } catch {
    // 缓存失败不影响响应
  }
}

async function readKvFallback(env) {
  try {
    const kv = getKv(env)
    const raw = await kv.get(KV_FALLBACK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function writeKvFallback(env, catalog) {
  try {
    const kv = getKv(env)
    await kv.put(KV_FALLBACK_KEY, JSON.stringify(catalog))
  } catch {
    // ignore
  }
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  const cached = await readCache()
  if (cached?.providers) {
    return jsonResponse({ ...cached, degraded: false }, 200, { 'Cache-Control': 'private, max-age=300' })
  }

  try {
    const upstream = await fetch(CATALOG_URL, { headers: { Accept: 'application/json' } })
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
    const catalog = compact(await upstream.json())
    await Promise.all([writeCache(catalog), writeKvFallback(env, catalog)])
    return jsonResponse({ ...catalog, degraded: false }, 200, { 'Cache-Control': 'private, max-age=300' })
  } catch (error) {
    const fallback = await readKvFallback(env)
    if (fallback?.providers) {
      return jsonResponse({ ...fallback, degraded: true }, 200, { 'Cache-Control': 'private, max-age=60' })
    }
    return jsonResponse(
      { error: 'catalog_unavailable', message: String(error?.message ?? error) },
      503
    )
  }
}
