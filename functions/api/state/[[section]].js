// /api/state            GET  一次返回全部节（秘密字段脱敏）
// /api/state/:section   PUT  乐观锁写入（If-Match: rev）
// /api/state/:section/append  POST 追加型合并（历史 / 用量）
import { appendSection, isSection, readAllSections, readSection, writeSection } from '../../_lib/kv.js'
import { maskSecrets, mergeSecrets } from '../../_lib/secrets.js'
import { jsonResponse } from '../../_lib/origin.js'

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 配置体积上限；KV 单值 25MiB，这里留足余量但也防滥用

/** 追加型数据的合并规则 */
const APPEND_MERGERS = {
  /** history: { records: [...] }；新的在前，按 fileName 去重，最多 200 条 */
  history: (current, patch) => {
    const existing = Array.isArray(current?.records) ? current.records : []
    const incoming = Array.isArray(patch?.records) ? patch.records : []
    const merged = [...incoming, ...existing]
    const seen = new Set()
    const out = []
    for (const record of merged) {
      const key = record?.fileName ?? record?.bookTitle ?? JSON.stringify(record)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(record)
    }
    return { records: out.slice(0, 200) }
  },
  /** usage: { tokenUsage, totalCostUSD, byModel: {model: {tokens, cost}} } */
  usage: (current, patch) => {
    const out = {
      tokenUsage: Number(current?.tokenUsage) || 0,
      totalCostUSD: Number(current?.totalCostUSD) || 0,
      byModel: { ...(current?.byModel ?? {}) },
    }
    out.tokenUsage += Number(patch?.tokenUsage) || 0
    out.totalCostUSD += Number(patch?.totalCostUSD) || 0

    const patchByModel = patch?.byModel && typeof patch.byModel === 'object' ? patch.byModel : {}
    for (const [model, value] of Object.entries(patchByModel)) {
      const prev = out.byModel[model] ?? { tokens: 0, costUSD: 0 }
      out.byModel[model] = {
        tokens: (Number(prev.tokens) || 0) + (Number(value?.tokens) || 0),
        costUSD: (Number(prev.costUSD) || 0) + (Number(value?.costUSD) || 0),
      }
    }
    return out
  },
}

function parsePath(url) {
  const rest = url.pathname.replace(/^\/api\/state\/?/, '').replace(/\/+$/, '')
  if (!rest) return { section: '', append: false }
  const parts = rest.split('/')
  return { section: parts[0], append: parts[1] === 'append' }
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const { section, append } = parsePath(url)

  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (section && !isSection(section)) return jsonResponse({ error: 'unknown_section' }, 404)
      if (section) {
        const value = await readSection(env, section)
        return jsonResponse(
          { section, value: value ? { rev: value.rev, updatedAt: value.updatedAt, data: maskSecrets(value.data) } : null },
          200,
          { 'Cache-Control': 'no-store' }
        )
      }
      const { sections, missing } = await readAllSections(env)
      const masked = {}
      for (const [name, value] of Object.entries(sections)) {
        masked[name] = { rev: value.rev, updatedAt: value.updatedAt, data: maskSecrets(value.data) }
      }
      return jsonResponse(
        { initialized: Object.keys(sections).length > 0, sections: masked, missing },
        200,
        { 'Cache-Control': 'no-store' }
      )
    }

    if (request.method === 'PUT') {
      if (!isSection(section)) return jsonResponse({ error: 'unknown_section' }, 404)

      const declaredLength = Number(request.headers.get('content-length') || 0)
      if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ error: 'payload_too_large' }, 413)

      const text = await request.text()
      if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: 'payload_too_large' }, 413)

      let body
      try {
        body = JSON.parse(text)
      } catch {
        return jsonResponse({ error: 'invalid_json' }, 400)
      }
      if (!body || typeof body !== 'object' || !('data' in body)) {
        return jsonResponse({ error: 'invalid_body' }, 400)
      }

      const ifMatch = request.headers.get('If-Match')
      const expectedRev = ifMatch === null || ifMatch === '*' ? null : Number(ifMatch)
      if (expectedRev !== null && !Number.isFinite(expectedRev)) {
        return jsonResponse({ error: 'invalid_if_match' }, 400)
      }

      const existing = await readSection(env, section)
      const merged = mergeSecrets(body.data, existing?.data ?? {})

      const result = await writeSection(env, section, merged, expectedRev)
      if (!result.ok) {
        return jsonResponse(
          {
            error: 'conflict',
            rev: result.conflict.rev,
            updatedAt: result.conflict.updatedAt,
            data: maskSecrets(result.conflict.data),
          },
          409,
          { 'Cache-Control': 'no-store' }
        )
      }

      return jsonResponse({ ok: true, rev: result.rev, updatedAt: result.updatedAt }, 200, {
        ETag: String(result.rev),
        'Cache-Control': 'no-store',
      })
    }

    if (request.method === 'POST' && append) {
      if (!isSection(section)) return jsonResponse({ error: 'unknown_section' }, 404)
      const merger = APPEND_MERGERS[section]
      if (!merger) return jsonResponse({ error: 'append_not_supported' }, 400)

      let body
      try {
        body = await request.json()
      } catch {
        return jsonResponse({ error: 'invalid_json' }, 400)
      }
      const patch = body?.patch
      if (!patch || typeof patch !== 'object') return jsonResponse({ error: 'invalid_body' }, 400)

      const result = await appendSection(env, section, patch, merger)
      return jsonResponse(
        { ok: true, rev: result.rev, updatedAt: result.updatedAt, data: maskSecrets(result.data) },
        200,
        { 'Cache-Control': 'no-store' }
      )
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT, POST' })
  } catch (error) {
    if (error?.code === 'kv_missing') {
      return jsonResponse({ error: 'kv_not_configured' }, 500)
    }
    return jsonResponse({ error: 'internal_error', message: String(error?.message ?? error) }, 500)
  }
}
