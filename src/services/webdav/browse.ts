import type { FileStat } from 'webdav'
import { normalizeDavPath } from '../webdavProxyUtils'
import type { DavContext, WebDAVFileInfo, WebDAVOperationResult } from './types'
import { buildHeaderPath } from './utils'

const SUPPORTED_EXTENSIONS = ['.epub', '.pdf', '.txt', '.md']

const errMsg = (error: unknown) => (error instanceof Error ? error.message : '未知错误')

/** 把库返回的 filename（可能是完整 URL）统一成相对 serverUrl 的绝对路径 */
function toRelativeFilename(raw: string, serverUrl: string): string {
  try {
    const itemUrl = new URL(raw)
    const baseUrl = new URL(serverUrl)
    let relativePath = itemUrl.pathname
    const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`
    if (relativePath.startsWith(basePath)) {
      relativePath = relativePath.substring(basePath.length - 1)
    }
    return normalizeDavPath(relativePath)
  } catch {
    return normalizeDavPath(raw)
  }
}

export function getDirectoryContents(
  ctx: DavContext,
  path: string,
  deep: boolean
): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
  return ctx.runExclusive(async () => {
    try {
      const rawPath = path || ctx.config?.browsePath || '/'
      ctx.setDavHeader(buildHeaderPath(normalizeDavPath(rawPath)))

      const contents = (await ctx.client!.getDirectoryContents('/', { deep })) as FileStat[] | FileStat
      const list = Array.isArray(contents) ? contents : [contents]

      const fileList: WebDAVFileInfo[] = list.map((item) => ({
        filename: toRelativeFilename(String(item.filename ?? ''), ctx.config!.serverUrl),
        basename: item.basename,
        lastmod: item.lastmod,
        size: item.size || 0,
        type: item.type,
        etag: item.etag ?? undefined,
        mime: item.mime
      }))
      return { success: true, data: fileList }
    } catch (error) {
      return { success: false, error: `获取目录内容失败: ${errMsg(error)}` }
    }
  })
}

/** 只保留 epub/pdf/txt/md 文件 */
export function filterSupportedFiles(files: WebDAVFileInfo[]): WebDAVFileInfo[] {
  return files.filter(
    (file) =>
      file.type === 'file' &&
      SUPPORTED_EXTENSIONS.some((ext) => file.basename.toLowerCase().endsWith(ext))
  )
}

export function getStat(ctx: DavContext, path: string): Promise<WebDAVOperationResult<WebDAVFileInfo>> {
  return ctx.runExclusive(async () => {
    try {
      const normalizedPath = normalizeDavPath(path)
      ctx.setDavHeader(buildHeaderPath(normalizedPath))
      const stat = (await ctx.client!.stat('/')) as unknown as Record<string, unknown>

      const fileInfo: WebDAVFileInfo = {
        filename: normalizedPath,
        basename:
          typeof stat.basename === 'string' ? stat.basename : normalizedPath.split('/').pop() || '',
        lastmod: typeof stat.lastmod === 'string' ? stat.lastmod : new Date().toISOString(),
        size: typeof stat.size === 'number' ? stat.size : 0,
        type: stat.type === 'directory' ? 'directory' : 'file',
        etag: typeof stat.etag === 'string' ? stat.etag : '',
        mime: typeof stat.mime === 'string' ? stat.mime : ''
      }
      return { success: true, data: fileInfo }
    } catch (error) {
      return { success: false, error: `获取文件信息失败: ${errMsg(error)}` }
    }
  })
}
