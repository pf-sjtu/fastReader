// 模型目录：服务端合并多个公开数据源，浏览器只拿「用得到的那一小部分」
//
// 数据源（按优先级合并，前者有值时不被覆盖）：
//   1. models.dev       —— 最全的服务商 × 模型矩阵，带服务商 api 端点（用于预设）
//   2. OpenRouter       —— 价格新、上下文准，supported_parameters 能告诉我们是否支持 reasoning_effort
//   3. LiteLLM 价格表   —— 补齐前两者都没有的模型（尤其 Azure/Bedrock 别名与旧模型）
//
// 体积：三份原始数据 ~10MB，合并后按「归一化模型 id」建一张扁平索引（~1MB），
// 浏览器永远不下载整份：预设列表 ~15KB，元数据按需查询（一次同步只传几十个 id）。
//
// 缓存：Cache API 6h（不占 KV 写额度）+ KV 兜底副本（上游全挂时仍可用，24h 才写一次）。

const SOURCES = {
  modelsDev: 'https://models.dev/api.json',
  openRouter: 'https://openrouter.ai/api/v1/models',
  liteLlm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
}

const CACHE_KEY = 'https://fastreader.internal/catalog-merged-v2'
const CACHE_TTL_SECONDS = 6 * 60 * 60
const KV_KEY = 'catalog:merged:v2'
const KV_REFRESH_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000

/** 与前端 services/ai/catalog.ts#normalizeModelId 同语义 */
export function normalizeModelId(raw) {
  let id = String(raw || '').trim().toLowerCase()
  const slash = id.lastIndexOf('/')
  if (slash !== -1 && slash < id.length - 1) id = id.slice(slash + 1)
  return id.replace(/(:(online|free|beta|thinking|reasoning|latest|extended))+$/g, '')
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const perMillion = (perToken) => {
  const n = typeof perToken === 'string' ? Number(perToken) : perToken
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined
}

/** 把一条来源记录并进索引：只填空位，不覆盖更高优先级来源已有的值 */
function mergeInto(index, key, entry) {
  if (!key) return
  const prev = index[key] || {}
  const next = { ...prev }
  for (const [k, v] of Object.entries(entry)) {
    if (v === undefined || v === null) continue
    if (k === 'src') {
      next.src = [...new Set([...(prev.src || []), v])]
      continue
    }
    if (next[k] === undefined) next[k] = v
  }
  index[key] = next
}

function fromModelsDev(raw, index, providers) {
  for (const [pid, p] of Object.entries(raw || {})) {
    if (!p || typeof p !== 'object') continue
    const models = Object.entries(p.models || {})
    providers[pid] = {
      name: typeof p.name === 'string' ? p.name : pid,
      ...(typeof p.api === 'string' ? { api: p.api } : {}),
      count: models.length,
    }
    for (const [mid, m] of models) {
      if (!m || typeof m !== 'object') continue
      const entry = {
        n: typeof m.name === 'string' ? m.name : undefined,
        c: num(m.limit?.context),
        o: num(m.limit?.output),
        i: num(m.cost?.input),
        x: num(m.cost?.output),
        r: typeof m.reasoning === 'boolean' ? m.reasoning : undefined,
        t: typeof m.temperature === 'boolean' ? m.temperature : undefined,
        src: 'models.dev',
      }
      // 精确 id（带服务商前缀）与归一化 id 都建索引：前者让 catalogId 命中更准
      mergeInto(index, `${pid}/${mid}`.toLowerCase(), entry)
      mergeInto(index, normalizeModelId(mid), entry)
    }
  }
}

function fromOpenRouter(raw, index) {
  for (const m of raw?.data || []) {
    if (!m || typeof m.id !== 'string') continue
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : []
    mergeInto(index, normalizeModelId(m.id), {
      n: typeof m.name === 'string' ? m.name.replace(/^[^:]+:\s*/, '') : undefined,
      c: num(m.context_length) ?? num(m.top_provider?.context_length),
      o: num(m.top_provider?.max_completion_tokens),
      i: perMillion(m.pricing?.prompt),
      x: perMillion(m.pricing?.completion),
      r: params.includes('reasoning') || params.includes('reasoning_effort') ? true : undefined,
      e: params.includes('reasoning_effort') ? true : undefined,
      t: params.includes('temperature') ? true : undefined,
      src: 'openrouter',
    })
  }
}

function fromLiteLlm(raw, index) {
  for (const [key, m] of Object.entries(raw || {})) {
    if (!m || typeof m !== 'object' || key === 'sample_spec') continue
    if (m.mode && m.mode !== 'chat' && m.mode !== 'responses') continue
    mergeInto(index, normalizeModelId(key), {
      c: num(m.max_input_tokens) ?? num(m.max_tokens),
      o: num(m.max_output_tokens),
      i: perMillion(m.input_cost_per_token),
      x: perMillion(m.output_cost_per_token),
      r: typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : undefined,
      src: 'litellm',
    })
  }
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 拉三个源并合并；单个源失败只降级、不整体失败 */
export async function buildCatalog(fetcher = fetchJson) {
  const [md, or, ll] = await Promise.allSettled([
    fetcher(SOURCES.modelsDev),
    fetcher(SOURCES.openRouter),
    fetcher(SOURCES.liteLlm),
  ])
  const index = {}
  const providers = {}
  const sources = {}
  // 优先级即合并顺序
  if (md.status === 'fulfilled') { fromModelsDev(md.value, index, providers); sources.modelsDev = 'ok' } else sources.modelsDev = 'failed'
  if (or.status === 'fulfilled') { fromOpenRouter(or.value, index); sources.openRouter = 'ok' } else sources.openRouter = 'failed'
  if (ll.status === 'fulfilled') { fromLiteLlm(ll.value, index); sources.liteLlm = 'ok' } else sources.liteLlm = 'failed'

  if (Object.keys(index).length === 0) throw new Error('all catalog sources failed')
  return { generatedAt: new Date().toISOString(), sources, providers, index }
}

async function readCache() {
  try {
    if (typeof caches === 'undefined' || !caches.default) return null
    const res = await caches.default.match(CACHE_KEY)
    return res ? await res.json() : null
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
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
      })
    )
  } catch {
    // 缓存失败不影响响应
  }
}

async function readKv(env) {
  try {
    const raw = await env?.FASTREADER_KV?.get?.(KV_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function writeKvIfStale(env, catalog, previous) {
  try {
    const age = previous?.generatedAt ? Date.now() - Date.parse(previous.generatedAt) : Infinity
    if (!(age > KV_REFRESH_MS)) return // KV 免费额度 1000 写/天：兜底副本一天写一次就够
    await env?.FASTREADER_KV?.put?.(KV_KEY, JSON.stringify(catalog))
  } catch {
    // ignore
  }
}

/**
 * 取合并目录：Cache API → 现拉（并回填缓存/KV）→ KV 兜底。
 * @returns {{ catalog, degraded: boolean }}
 */
export async function getCatalog(env, { fetcher } = {}) {
  const cached = await readCache()
  if (cached?.index) return { catalog: cached, degraded: false }

  const kv = await readKv(env)
  try {
    const fresh = await buildCatalog(fetcher)
    await Promise.all([writeCache(fresh), writeKvIfStale(env, fresh, kv)])
    const degraded = Object.values(fresh.sources).some((s) => s !== 'ok')
    return { catalog: fresh, degraded }
  } catch (error) {
    if (kv?.index) return { catalog: kv, degraded: true }
    throw error
  }
}

/** 给浏览器的元数据：只回传请求的 id；先按「服务商/模型」精确，再按归一化 id */
export function lookupModels(catalog, ids, catalogId) {
  const out = {}
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue
    const exact = catalogId ? catalog.index[`${catalogId}/${id}`.toLowerCase()] : undefined
    const hit = exact || catalog.index[id.toLowerCase()] || catalog.index[normalizeModelId(id)]
    if (hit) out[id] = hit
  }
  return out
}

/** 预设：只列带 api 端点、可直接按 OpenAI 兼容接入的服务商 */
export function listPresets(catalog) {
  return Object.entries(catalog.providers || {})
    .filter(([, p]) => typeof p.api === 'string' && p.api)
    .map(([id, p]) => ({ id, name: p.name || id, api: p.api, modelCount: p.count || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
