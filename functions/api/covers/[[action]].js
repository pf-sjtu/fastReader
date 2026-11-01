// /api/covers            GET   封面索引 {items: {id: {stem,title,author,pages,chapterCount,cover}}}
// /api/covers/:id        GET   封面图（webp，不可变，可长缓存）
// /api/covers/:id        PUT   上传一张封面（body = webp 字节）；元数据放 X-Book-Meta（encodeURIComponent 的 JSON）
// /api/covers/bulk       POST  {items:[{id, meta, image?(base64)}], overwrite?} 批量写入（脚本预处理用）
//
// 全部要求已登录（_middleware 统一拦截）；写操作额外要求同源或无 Origin（脚本不带 Origin）。
import { ID_RE, MAX_BODY_BYTES, MAX_BULK_ITEMS, MAX_IMAGE_BYTES, cleanMeta, putItems, readCover, readIndex } from '../../_lib/covers.js'
import { isSameOriginRequest, jsonResponse } from '../../_lib/origin.js'

const actionOf = (url) => url.pathname.replace(/^\/api\/covers\/?/, '').replace(/\/+$/, '')

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const action = actionOf(url)
  const method = request.method

  if (method === 'OPTIONS') return new Response(null, { status: 204 })

  try {
    if (action === '' && method === 'GET') {
      const index = await readIndex(env)
      return jsonResponse(index, 200, { 'Cache-Control': 'private, max-age=300' })
    }

    if (method === 'PUT' || method === 'POST') {
      const origin = request.headers.get('Origin')
      if (origin && !isSameOriginRequest(request, origin)) return jsonResponse({ error: 'forbidden_origin' }, 403)
    }

    if (action === 'bulk' && method === 'POST') {
      const len = Number(request.headers.get('Content-Length') || 0)
      if (len > MAX_BODY_BYTES) return jsonResponse({ error: 'too_large' }, 413)
      let body
      try {
        body = await request.json()
      } catch {
        return jsonResponse({ error: 'invalid_json' }, 400)
      }
      const items = Array.isArray(body?.items) ? body.items : []
      if (items.length === 0 || items.length > MAX_BULK_ITEMS) return jsonResponse({ error: 'bad_items', max: MAX_BULK_ITEMS }, 400)
      const results = await putItems(env, items, { overwrite: body?.overwrite === true })
      return jsonResponse({ results }, 200, { 'Cache-Control': 'no-store' })
    }

    if (ID_RE.test(action)) {
      if (method === 'GET') {
        const b64 = await readCover(env, action)
        if (!b64) return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=60' } })
        return new Response(fromBase64(b64), {
          status: 200,
          headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400, immutable' },
        })
      }
      if (method === 'PUT') {
        const buf = await request.arrayBuffer()
        if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return jsonResponse({ error: 'bad_image_size', max: MAX_IMAGE_BYTES }, 413)
        let meta = {}
        try {
          meta = cleanMeta(JSON.parse(decodeURIComponent(request.headers.get('X-Book-Meta') || '{}')))
        } catch {
          return jsonResponse({ error: 'bad_meta' }, 400)
        }
        const [result] = await putItems(env, [{ id: action, meta, image: toBase64(buf) }])
        return jsonResponse(result, result.status === 'bad_image' ? 400 : 200, { 'Cache-Control': 'no-store' })
      }
    }

    return jsonResponse({ error: 'not_found' }, 404)
  } catch (error) {
    if (error?.code === 'kv_missing') return jsonResponse({ error: 'kv_missing' }, 503)
    return jsonResponse({ error: 'covers_failed', message: String(error?.message ?? error) }, 500)
  }
}
