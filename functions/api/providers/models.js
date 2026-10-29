// /api/providers/models —— 从服务商拉取可用模型列表
//
// body: { providerId?: string, type?: 'openai'|'gemini'|'ollama', baseUrl?: string, apiKey?: string }
//   - 已有服务商：只传 providerId，baseUrl 与密钥从共享状态取
//   - 新服务商（尚未保存）：传 baseUrl + apiKey
//
// Ollama 在本机（http://localhost:11434），服务端不可达 → 返回 ollama_use_direct，由浏览器直连。
import { jsonResponse } from '../../_lib/origin.js'
import { authHeadersForProtocol, resolveProvider } from '../../_lib/upstream.js'
import { isValidUpstreamBase } from '../../../src/services/webdavProxyUtils'

const MAX_MODELS = 1000

async function fetchJson(url, headers) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'manual' })
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, message: text.slice(0, 400) }
    }
    try {
      return { ok: true, data: JSON.parse(text) }
    } catch {
      return { ok: false, status: 502, message: 'upstream returned non-JSON' }
    }
  } catch (error) {
    return { ok: false, status: 502, message: String(error?.message ?? error) }
  } finally {
    clearTimeout(timeout)
  }
}

function parseOpenAiModels(data) {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
  return list
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

function parseGeminiModels(data) {
  const list = Array.isArray(data?.models) ? data.models : []
  return list
    .map((item) => (typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : null))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

function parseOllamaModels(data) {
  const list = Array.isArray(data?.models) ? data.models : []
  return list
    .map((item) => (typeof item?.name === 'string' ? item.name : null))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

function trimBase(baseUrl) {
  return baseUrl.replace(/\/+$/, '')
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const type = ['gemini', 'ollama', 'anthropic'].includes(body?.type) ? body.type : 'openai'

  if (type === 'ollama') {
    // 服务端无法访问用户本机的 Ollama
    return jsonResponse({ error: 'ollama_use_direct' }, 400)
  }

  let baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
  let apiKey = typeof body?.apiKey === 'string' ? body.apiKey : ''

  if (body?.providerId) {
    let provider
    try {
      provider = await resolveProvider(env, String(body.providerId))
    } catch (error) {
      if (error?.code === 'kv_missing') return jsonResponse({ error: 'kv_not_configured' }, 500)
      throw error
    }
    if (!provider) return jsonResponse({ error: 'unknown_provider' }, 404)

    // 安全关键：带着服务端密钥去访问「客户端指定的地址」等于把 Key 送给任何人。
    // 因此只有客户端自带 apiKey（要探测一个新端点）时才允许用它给的 baseUrl；
    // 用服务端密钥时，上游地址必须也来自服务端。
    const clientProvidedKey = typeof body?.apiKey === 'string' && body.apiKey.length > 0
    if (clientProvidedKey) {
      apiKey = body.apiKey
    } else {
      baseUrl = provider.baseUrl
      apiKey = provider.apiKey
    }
  }

  if (!baseUrl) return jsonResponse({ error: 'missing_base_url' }, 400)
  if (!isValidUpstreamBase(baseUrl)) return jsonResponse({ error: 'invalid_base_url' }, 400)

  const headers = { Accept: 'application/json', ...authHeadersForProtocol(type, apiKey) }
  const endpoint = type === 'gemini' ? `${trimBase(baseUrl)}/models` : `${trimBase(baseUrl)}/models`
  const result = await fetchJson(endpoint, headers)

  if (!result.ok) {
    return jsonResponse(
      { error: 'upstream_failed', status: result.status, message: result.message },
      result.status === 401 || result.status === 403 ? 401 : 502
    )
  }

  const models =
    type === 'gemini' ? parseGeminiModels(result.data) : parseOpenAiModels(result.data)

  const unique = [...new Set(models)].slice(0, MAX_MODELS)
  return jsonResponse({ models: unique, count: unique.length })
}
