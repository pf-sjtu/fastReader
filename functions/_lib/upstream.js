// 从共享状态中解析服务商 / WebDAV 的上游配置（供 /api/ai、/api/dav、/api/providers/models 复用）
import { readSection } from './kv.js'

/** AI 协议 → 鉴权方式 */
export function authHeadersForProtocol(type, apiKey) {
  const headers = {}
  if (!apiKey) return headers
  if (type === 'gemini') headers['x-goog-api-key'] = apiKey
  else headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

/** 从 state:ai 中按 id 取服务商（含秘密） */
export async function resolveProvider(env, providerId) {
  if (!providerId || typeof providerId !== 'string') return null
  const section = await readSection(env, 'ai')
  const providers = Array.isArray(section?.data?.providers) ? section.data.providers : []
  const provider = providers.find((p) => p && p.id === providerId)
  if (!provider) return null
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type === 'gemini' || provider.type === 'ollama' ? provider.type : 'openai',
    baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : '',
    apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
  }
}

/** 从 state:webdav 中取 DAV 连接配置（含秘密） */
export async function resolveWebdav(env) {
  const section = await readSection(env, 'webdav')
  const data = section?.data ?? {}
  const password = typeof data.password === 'string' ? data.password : ''
  const username = typeof data.username === 'string' ? data.username : ''
  const serverUrl = typeof data.serverUrl === 'string' ? data.serverUrl : ''
  return {
    serverUrl,
    username,
    password,
    basicAuth:
      username && password ? `Basic ${base64(`${username}:${password}`)}` : '',
  }
}

function base64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
