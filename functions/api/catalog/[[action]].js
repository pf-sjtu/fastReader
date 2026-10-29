// /api/catalog          GET   服务商预设（向导用，~15KB）
// /api/catalog/lookup   POST  { ids: string[], catalogId?: string } → 只回这些模型的元数据
//
// 合并 models.dev + OpenRouter + LiteLLM（见 functions/_lib/catalog.js），浏览器不再下载 ~1MB 的整份目录。
import { getCatalog, listPresets, lookupModels } from '../../_lib/catalog.js'
import { jsonResponse } from '../../_lib/origin.js'

const MAX_LOOKUP_IDS = 500

function actionOf(url) {
  return url.pathname.replace(/^\/api\/catalog\/?/, '').replace(/\/+$/, '')
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const action = actionOf(url)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  let result
  try {
    result = await getCatalog(env)
  } catch (error) {
    return jsonResponse({ error: 'catalog_unavailable', message: String(error?.message ?? error) }, 503)
  }
  const { catalog, degraded } = result
  const meta = { generatedAt: catalog.generatedAt, sources: catalog.sources, degraded }

  if (action === '' && request.method === 'GET') {
    return jsonResponse({ ...meta, presets: listPresets(catalog) }, 200, { 'Cache-Control': 'private, max-age=600' })
  }

  if (action === 'lookup' && request.method === 'POST') {
    let body
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
    const ids = Array.isArray(body?.ids) ? body.ids.slice(0, MAX_LOOKUP_IDS) : []
    const catalogId = typeof body?.catalogId === 'string' ? body.catalogId : undefined
    return jsonResponse({ ...meta, models: lookupModels(catalog, ids, catalogId) }, 200, { 'Cache-Control': 'no-store' })
  }

  return jsonResponse({ error: 'not_found' }, 404)
}
