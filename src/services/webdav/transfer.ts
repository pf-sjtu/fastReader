import { normalizeDavPath } from '../webdavProxyUtils'
import { classifyExistsStatus, describeProxyError, isProxyErrorResponse } from './errors'
import { probeStatus } from './exists'
import type { DavContext, WebDAVOperationResult } from './types'
import { buildHeaderPath, normalizeToArrayBuffer, toUploadBody } from './utils'

const NO_CACHE_HEADERS = { 'Cache-Control': 'no-store, no-cache', Pragma: 'no-cache' }

const errMsg = (error: unknown) => (error instanceof Error ? error.message : '未知错误')

/** 非 2xx 响应 → 错误文本；代理自身错误给出明确原因，不与上游同码混淆 */
async function failureText(prefix: string, res: Response, bodyLimit: number): Promise<string> {
  if (isProxyErrorResponse(res)) return `${prefix}: ${describeProxyError(res.status)}`
  const t = await res.text().catch(() => '')
  return `${prefix}: Invalid response: ${res.status} ${res.statusText}${t ? ` ${t.slice(0, bodyLimit)}` : ''}`
}

export function getFileContents(
  ctx: DavContext,
  filePath: string,
  format: 'text' | 'binary'
): Promise<WebDAVOperationResult<string | ArrayBuffer>> {
  return ctx.runExclusive(async () => {
    try {
      if (!ctx.config) {
        return { success: false, error: 'WebDAV配置未找到' }
      }

      // 浏览器：同源代理直连 GET（路径只在 header，避免库内部 header 竞态）
      if (ctx.isBrowserProxyMode()) {
        const res = await ctx.proxyFetch('GET', filePath, {
          extraHeaders: { Accept: format === 'text' ? 'text/plain, */*' : '*/*' },
        })
        if (res.status === 404 && !isProxyErrorResponse(res)) {
          console.warn('[WebDAV] 文件不存在 (404):', filePath)
          return { success: false, error: '下载文件失败: Invalid response: 404 Not Found' }
        }
        if (!res.ok) {
          return { success: false, error: await failureText('下载文件失败', res, 80) }
        }
        return { success: true, data: format === 'text' ? await res.text() : await res.arrayBuffer() }
      }

      if (!ctx.client) {
        return { success: false, error: 'WebDAV客户端未初始化' }
      }

      ctx.setDavHeader(buildHeaderPath(normalizeDavPath(filePath)))

      if (format === 'text') {
        const content = (await ctx.client.getFileContents('/', {
          format: 'text',
          headers: NO_CACHE_HEADERS
        })) as string
        return { success: true, data: content }
      }

      const binaryContent = await ctx.client.getFileContents('/', {
        format: 'binary',
        headers: NO_CACHE_HEADERS
      })
      return { success: true, data: await normalizeToArrayBuffer(binaryContent) }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // 缓存未命中是常见情况（无完整摘要），用 warn 而非 error
      if (msg.includes('404') || msg.includes('Not Found') || msg.includes('Invalid response: 404')) {
        console.warn('[WebDAV] 文件不存在 (404):', filePath)
      } else {
        console.error('获取文件内容失败:', error)
      }
      return { success: false, error: `下载文件失败: ${msg}` }
    }
  })
}

/**
 * 已确认存在的目录（按服务器 + 账号区分）：上传一本书的几十个文件时不必逐级重复探测。
 * PUT 失败时清空对应账号的缓存，下次重新探测（目录可能被外部删除）。
 */
const confirmedDirs = new Map<string, Set<string>>()

function confirmedSet(ctx: DavContext): Set<string> {
  const key = `${ctx.config?.serverUrl ?? ''}|${ctx.config?.username ?? ''}`
  let set = confirmedDirs.get(key)
  if (!set) confirmedDirs.set(key, (set = new Set()))
  return set
}

/** 仅供测试：清空目录确认缓存 */
export function resetConfirmedDirs(): void {
  confirmedDirs.clear()
}

/**
 * 确保 dirPath 及其所有祖先目录存在：自顶向下逐级「先探测再 MKCOL」。
 * 标准 WebDAV 服务器（如 Apache mod_dav）对缺少上级目录的 MKCOL 返回 409，因此不能只建最后一级。
 * 浏览器模式下失败不阻断后续 PUT（由 PUT 的结果为准）。
 */
async function ensureParentDir(ctx: DavContext, dirPath: string, tolerant: boolean): Promise<void> {
  const known = confirmedSet(ctx)
  const create = async () => {
    let current = ''
    for (const segment of dirPath.split('/').filter(Boolean)) {
      current += `/${segment}`
      if (known.has(current)) continue
      const probe = await probeStatus(ctx, current)
      const kind = classifyExistsStatus(probe.status, !!probe.proxyError)
      if (kind === 'missing') {
        ctx.setDavHeader(buildHeaderPath(current))
        await ctx.client!.createDirectory('/')
        known.add(current)
      } else if (kind === 'exists') {
        known.add(current)
      }
      // unknown（鉴权/网络/5xx）：按存在处理继续，但不缓存，下次重新探测
    }
  }
  if (!tolerant) return create()
  try {
    await create()
  } catch (e) {
    console.warn('[WebDAV] 确保目录存在失败（继续 PUT）:', dirPath, e)
  }
}

export function putFileContents(
  ctx: DavContext,
  filePath: string,
  data: string | ArrayBuffer | Blob,
  overwrite: boolean
): Promise<WebDAVOperationResult<boolean>> {
  return ctx.runExclusive(async () => {
    try {
      if (!ctx.config) {
        return { success: false, error: 'WebDAV配置未找到' }
      }

      const normalizedPath = normalizeDavPath(filePath)
      const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
      const needDir = !!dirPath && dirPath !== '/'

      // 浏览器：代理直连 PUT（UTF-8 字节体 + 正确 Content-Length）
      if (ctx.isBrowserProxyMode()) {
        if (needDir && ctx.client) await ensureParentDir(ctx, dirPath, true)

        const { body, byteLength } = toUploadBody(data)
        const extraHeaders: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        if (typeof byteLength === 'number') extraHeaders['Content-Length'] = String(byteLength)
        if (!overwrite) extraHeaders['If-None-Match'] = '*'

        const res = await ctx.proxyFetch('PUT', normalizedPath, { body, extraHeaders })
        // 201 Created / 204 No Content / 200 OK 均视为成功
        if (res.ok) {
          console.log(`[WebDAV:proxy] PUT ok status=${res.status} path=${normalizedPath}`)
          return { success: true, data: true }
        }
        // 403/404/409 可能意味着目录已被外部删除：下次重新探测（412 等是正常的业务拒绝，不清）
        if (res.status === 403 || res.status === 404 || res.status === 409) confirmedSet(ctx).clear()
        const error = await failureText('上传文件失败', res, 120)
        console.warn(`[WebDAV:proxy] PUT fail status=${res.status} path=${normalizedPath}`, error.slice(0, 200))
        return { success: false, error }
      }

      if (!ctx.client) {
        return { success: false, error: 'WebDAV客户端未初始化' }
      }

      if (needDir) await ensureParentDir(ctx, dirPath, false)

      ctx.setDavHeader(buildHeaderPath(normalizedPath))
      const result = await ctx.client.putFileContents('/', data as unknown as string | ArrayBuffer, {
        overwrite
      })
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: `上传文件失败: ${errMsg(error)}` }
    }
  })
}
