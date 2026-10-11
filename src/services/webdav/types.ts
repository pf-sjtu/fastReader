import type { WebDAVClient } from 'webdav'
import type { WebDAVConfig } from '../../stores/configStore'

// WebDAV文件信息接口
export interface WebDAVFileInfo {
  filename: string
  basename: string
  lastmod: string
  size: number
  type: 'file' | 'directory'
  etag?: string
  mime?: string
}

// WebDAV操作结果接口
export interface WebDAVOperationResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// WebDAV上传进度回调
export type UploadProgressCallback = (progress: number) => void

/** 存在性三态（契约 C4） */
export type DavExistsStatus = 'exists' | 'missing' | 'unknown'

/** 单次探测结果：HTTP 状态（网络错误为 undefined）+ 代理自身错误原因（若有） */
export interface ProbeResult {
  status: number | undefined
  proxyError?: string
}

/** 拆分出的操作模块使用的上下文，由 WebDAVService 在每次调用时构造 */
export interface DavContext {
  client: WebDAVClient | null
  config: WebDAVConfig | null
  setDavHeader(path: string): void
  proxyFetch(
    method: string,
    filePath: string,
    options?: { body?: BodyInit | null; extraHeaders?: Record<string, string> }
  ): Promise<Response>
  isBrowserProxyMode(): boolean
  /** 串行锁；已在锁内的调用方不得再调用 */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>
}
