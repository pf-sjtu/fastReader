// /api/covers            GET   目录索引 {rev, items: {id: {stem,title,author,pages,chapterCount,file,size,subjects,desc,publisher,year,lang,cover,updatedAt}}}
//                              带 ETag（= rev），If-None-Match 命中回 304
// /api/covers/:id        GET   封面图（webp，不可变，可长缓存）
// /api/covers/:id        PUT   上传封面（body = webp 字节；空 body = 只更新元数据）；元数据放 X-Book-Meta（encodeURIComponent 的 JSON）；?replace=1 覆盖已有封面
// /api/covers/:id        DELETE 删除这本书的封面与元数据（用户确认 WebDAV 上已找不到后才调用）
// /api/covers/delete     POST  {ids:[…≤200]} 批量删除，索引只写一次
// /api/covers/bulk       POST  {items:[{id, meta, image?(base64)}], overwrite?} 批量写入（脚本预处理用）
//
// 全部要求已登录（_middleware 统一拦截）；写操作额外要求同源或无 Origin（脚本不带 Origin）。
import { ID_RE, MAX_BODY_BYTES, MAX_BULK_ITEMS, MAX_DELETE_IDS, MAX_IMAGE_BYTES, cleanMeta, deleteItems, putItems, readCover, readIndex } from '../../_lib/covers.js'
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
      // ETag = 索引版本号。no-cache = 每次都向服务端确认，但没变化时只回 304（浏览器自动带 If-None-Match）
      const etag = `"r${index.rev}"`
      const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers })
      return jsonResponse(index, 200, headers)
    }

    if (method === 'PUT' || method === 'POST' || method === 'DELETE') {
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

    if (action === 'delete' && method === 'POST') {
      let body
      try {
        body = await request.json()
      } catch {
        return jsonResponse({ error: 'invalid_json' }, 400)
      }
      const ids = Array.isArray(body?.ids) ? body.ids : []
      if (ids.length === 0 || ids.length > MAX_DELETE_IDS) return jsonResponse({ error: 'bad_ids', max: MAX_DELETE_IDS }, 400)
      return jsonResponse({ results: await deleteItems(env, ids) }, 200, { 'Cache-Control': 'no-store' })
    }

    if (ID_RE.test(action)) {
      if (method === 'DELETE') {
        const [result] = await deleteItems(env, [action])
        return jsonResponse(result, 200, { 'Cache-Control': 'no-store' })
      }
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
        const metaHeader = request.headers.get('X-Book-Meta')
        // 空 body + 有元数据 = 只更新元数据（补字段、书变了但没取到新封面时用）；其余情况必须带合法图片
        if (buf.byteLength > MAX_IMAGE_BYTES || (buf.byteLength === 0 && !metaHeader)) {
          return jsonResponse({ error: 'bad_image_size', max: MAX_IMAGE_BYTES }, 413)
        }
        let meta = {}
        try {
          meta = cleanMeta(JSON.parse(decodeURIComponent(metaHeader || '{}')))
        } catch {
          return jsonResponse({ error: 'bad_meta' }, 400)
        }
        // ?replace=1：源文件变了（size 不一致）时用新封面覆盖旧的
        const replace = url.searchParams.get('replace') === '1'
        const [result] = await putItems(env, [{ id: action, meta, image: buf.byteLength ? toBase64(buf) : undefined }], { overwrite: replace })
        return jsonResponse(result, result.status === 'bad_image' ? 400 : 200, { 'Cache-Control': 'no-store' })
      }
    }

    return jsonResponse({ error: 'not_found' }, 404)
  } catch (error) {
    if (error?.code === 'kv_missing') return jsonResponse({ error: 'kv_missing' }, 503)
    return jsonResponse({ error: 'covers_failed', message: String(error?.message ?? error) }, 500)
  }
}
