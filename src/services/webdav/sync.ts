import { getMimeType } from '../../utils/file'
import type { WebDAVConfig } from '../../stores/configStore'
import type { UploadProgressCallback, WebDAVOperationResult } from './types'

/** 同步/下载只依赖 WebDAVService 的这几个公开方法 */
export interface DavSyncHost {
  getConfig(): WebDAVConfig | null
  isInitialized(): boolean
  exists(path: string): Promise<WebDAVOperationResult<boolean>>
  createDirectory(path: string): Promise<WebDAVOperationResult<boolean>>
  putFileContents(path: string, data: string | ArrayBuffer | Blob, overwrite?: boolean): Promise<WebDAVOperationResult<boolean>>
  getFileContents(path: string, format?: 'text' | 'binary'): Promise<WebDAVOperationResult<string | ArrayBuffer>>
}

const NOT_INITIALIZED = 'WebDAV客户端未初始化'
const errMsg = (error: unknown) => (error instanceof Error ? error.message : '未知错误')

/** 确保同步目录存在 */
export async function ensureSyncDirectory(host: DavSyncHost): Promise<WebDAVOperationResult<boolean>> {
  const config = host.getConfig()
  if (!config) return { success: false, error: 'WebDAV配置未设置' }

  const syncPath = config.syncPath || '/fastReader'
  const existsResult = await host.exists(syncPath)
  if (!existsResult.success) return existsResult
  if (!existsResult.data) return host.createDirectory(syncPath)
  return { success: true, data: true }
}

/** 同步文件到 WebDAV */
export async function syncFiles(
  host: DavSyncHost,
  localFiles: Array<{ name: string; content: string | ArrayBuffer; path: string }>,
  onProgress?: UploadProgressCallback
): Promise<WebDAVOperationResult<boolean>> {
  const config = host.getConfig()
  if (!host.isInitialized() || !config) return { success: false, error: NOT_INITIALIZED }

  try {
    const ensureDirResult = await ensureSyncDirectory(host)
    if (!ensureDirResult.success) return ensureDirResult

    const syncPath = config.syncPath || '/fastReader'
    let successCount = 0

    for (let i = 0; i < localFiles.length; i++) {
      const file = localFiles[i]
      const uploadResult = await host.putFileContents(`${syncPath}/${file.path || file.name}`, file.content, true)
      if (uploadResult.success) successCount++
      onProgress?.((i + 1) / localFiles.length)
    }

    if (successCount === localFiles.length) return { success: true, data: true }
    return { success: false, error: `部分文件上传失败 (${successCount}/${localFiles.length})` }
  } catch (error) {
    return { success: false, error: `同步文件失败: ${errMsg(error)}` }
  }
}

/** 下载文件并转换为 File 对象；fileName 可选，用于避免特殊字符问题 */
export async function downloadFileAsFile(
  host: DavSyncHost,
  filePath: string,
  fileName?: string
): Promise<WebDAVOperationResult<File>> {
  try {
    let normalizedPath = filePath
    if (normalizedPath.startsWith('../dav/')) {
      normalizedPath = normalizedPath.replace('../dav/', '/')
    }
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath
    }

    const contentResult = await host.getFileContents(normalizedPath, 'binary')
    if (!contentResult.success || !contentResult.data) {
      return { success: false, error: contentResult.error || '获取文件内容失败' }
    }

    const finalFileName = fileName || normalizedPath.split('/').pop() || 'downloaded_file'
    const file = new File([contentResult.data], finalFileName, { type: getMimeType(finalFileName) })
    return { success: true, data: file }
  } catch (error) {
    return { success: false, error: `下载文件失败: ${errMsg(error)}` }
  }
}
