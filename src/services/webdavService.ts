import { createClient, type WebDAVClient } from 'webdav'
import type { WebDAVConfig } from '../stores/configStore'
import { buildWebdavProxyUrl, normalizeDavPath, encodeDavHeaderPath } from './webdavProxyUtils'
import { describeConnectionError } from './webdav/errors'
import { logger } from '../lib/logger'
import { existsDetail } from './webdav/exists'
import { getDirectoryContents, filterSupportedFiles, getStat } from './webdav/browse'
import { getFileContents, putFileContents } from './webdav/transfer'
import { bindWebDAVServiceToStore } from './webdav/bind'
import { ensureSyncDirectory, syncFiles, downloadFileAsFile } from './webdav/sync'
import type { ProgressOptions } from './webdav/progress'
import type {
  DavContext,
  DavExistsStatus,
  UploadProgressCallback,
  WebDAVFileInfo,
  WebDAVOperationResult
} from './webdav/types'
import { buildHeaderPath, getProcessedUrl } from './webdav/utils'

// 类型与工具函数 re-export，保持原导入路径稳定（契约 S3）
export type {
  WebDAVFileInfo,
  WebDAVOperationResult,
  UploadProgressCallback,
  DavExistsStatus
} from './webdav/types'
export {
  EXISTS_MAX_ATTEMPTS,
  EXISTS_RETRY_BASE_MS,
  getDavErrorStatus,
  classifyExistsStatus,
  describeConnectionError
} from './webdav/errors'
export type { WebDAVConfig } from '../stores/configStore'
export { bindWebDAVServiceToStore }

const NOT_INITIALIZED = 'WebDAV客户端未初始化'

const errMsg = (error: unknown) => (error instanceof Error ? error.message : '未知错误')

// WebDAV客户端封装类
export class WebDAVService {
  private client: WebDAVClient | null = null
  private config: WebDAVConfig | null = null
  private readyListeners = new Set<() => void>()
  /**
   * 串行化所有依赖 X-WebDAV-Path 的请求。
   * 代理模式用共享 client 的可变 header 传真实路径，并发 Promise.all 会互相覆盖导致错读/假 404。
   */
  private opChain: Promise<unknown> = Promise.resolve()

  /** 设置 WebDAV 请求头（自动编码路径） */
  private setDavHeader(path: string): void {
    if (!this.client) return
    this.client.setHeaders({
      ...this.client.getHeaders(),
      'X-WebDAV-Path': encodeDavHeaderPath(path),
      'X-Request-Origin': window.location.origin
    })
  }

  /** 在同一时刻只跑一个 DAV 操作，避免 header 竞态 */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn)
    this.opChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** 浏览器是否走同源 /api/dav 代理 */
  private isBrowserProxyMode(): boolean {
    return typeof window !== 'undefined'
  }

  /**
   * 浏览器代理直连：不依赖 webdav 库「始终请求 /」的路径模型，
   * 把真实路径放在 X-WebDAV-Path，避免 PUT/GET 与库内部 header 合并出问题。
   */
  private async proxyFetch(
    method: string,
    filePath: string,
    options?: { body?: BodyInit | null; extraHeaders?: Record<string, string>; signal?: AbortSignal }
  ): Promise<Response> {
    if (!this.config) {
      throw new Error('WebDAV配置未找到')
    }
    const headerPath = buildHeaderPath(normalizeDavPath(filePath))
    // 凭据在服务端：/api/dav 会用它保存的 Basic Auth 覆盖请求头，客户端不需要（也无法）拼 Authorization
    const headers: Record<string, string> = {
      'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
      'X-Request-Origin': window.location.origin,
      'Cache-Control': 'no-store, no-cache',
      Pragma: 'no-cache',
      ...(options?.extraHeaders || {}),
    }
    logger.debug(`[WebDAV:proxy] ${method} path=${headerPath}`)
    return fetch('/api/dav/', { method, headers, body: options?.body ?? null, signal: options?.signal })
  }

  /** 给拆分出的操作模块用的上下文（每次调用取最新 client/config） */
  private ctx(): DavContext {
    // 用 getter 读取最新值：排队等锁期间可能已 disconnect / 换配置
    return Object.defineProperties(
      {
        setDavHeader: (p: string) => this.setDavHeader(p),
        proxyFetch: (m: string, p: string, o?: Parameters<WebDAVService['proxyFetch']>[2]) =>
          this.proxyFetch(m, p, o),
        isBrowserProxyMode: () => this.isBrowserProxyMode(),
        runExclusive: <T>(fn: () => Promise<T>) => this.runExclusive(fn)
      },
      {
        client: { get: () => this.client, enumerable: true },
        config: { get: () => this.config, enumerable: true }
      }
    ) as DavContext
  }

  /** 用单次串行 DAV 操作包装「设置路径头 → 调库」的简单场景 */
  private runPathOp(
    path: string,
    failPrefix: string,
    op: (client: WebDAVClient) => Promise<unknown>
  ): Promise<WebDAVOperationResult<boolean>> {
    return this.runExclusive(async () => {
      try {
        this.setDavHeader(buildHeaderPath(normalizeDavPath(path)))
        await op(this.client!)
        return { success: true, data: true }
      } catch (error) {
        return { success: false, error: `${failPrefix}: ${errMsg(error)}` }
      }
    })
  }

  /**
   * 初始化WebDAV客户端
   * @param config WebDAV配置
   */
  async initialize(config: WebDAVConfig): Promise<WebDAVOperationResult<boolean>> {
    try {
      if (!config.serverUrl || !config.username || !config.password?.hasSecret) {
        return { success: false, error: 'WebDAV_CONFIG_INCOMPLETE' }
      }

      // 已用相同配置连上：跳过重建，避免处理中途 re-init 把 client 置空
      if (
        this.client &&
        this.config &&
        this.config.serverUrl === config.serverUrl &&
        this.config.username === config.username
      ) {
        this.config = { ...this.config, ...config }
        return { success: true, data: true }
      }

      this.config = config

      const headers: Record<string, string> = {
        'User-Agent': 'ebook-to-mindmap/1.0',
        'Accept': 'application/xml, text/xml, */*',
        'Cache-Control': 'no-store, no-cache',
        'Pragma': 'no-cache'
      }
      if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        headers['X-Requested-With'] = 'XMLHttpRequest'
      }

      // 凭据由 /api/dav 注入：这里不把 username/password 交给 webdav 客户端
      this.client = createClient(getProcessedUrl(config.serverUrl), { headers })

      const testResult = await this.testConnection()
      if (!testResult.success) {
        this.client = null
        return testResult
      }

      this.readyListeners.forEach((fn) => fn())
      return { success: true, data: true }
    } catch (error) {
      return { success: false, error: `WebDAV客户端初始化失败: ${errMsg(error)}` }
    }
  }

  /** 订阅「初始化成功」（自动连接 / 手动连接都会触发）；返回取消订阅函数 */
  onInitialized(listener: () => void): () => void {
    this.readyListeners.add(listener)
    return () => this.readyListeners.delete(listener)
  }

  /** 测试WebDAV连接 */
  async testConnection(): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: NOT_INITIALIZED }
    }

    return this.runExclusive(async () => {
      try {
        this.setDavHeader('/')
        await this.client!.getDirectoryContents('/')

        if (this.config?.syncPath) {
          const normalizedSyncPath = normalizeDavPath(this.config.syncPath)
          if (normalizedSyncPath !== '/') {
            this.setDavHeader(normalizedSyncPath)

            const exists = await this.client!.exists('/')
            if (!exists) {
              await this.client!.createDirectory('/')
            }
          }
        }

        return { success: true, data: true }
      } catch (error) {
        if (!(error instanceof Error)) {
          console.error('WebDAV连接测试失败 - 未知错误:', error)
        }
        return { success: false, error: describeConnectionError(error) }
      }
    })
  }

  /**
   * 获取目录内容
   * @param path 目录路径
   * @param deep 是否递归获取子目录
   */
  async getDirectoryContents(
    path: string = '/',
    deep: boolean = false
  ): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return getDirectoryContents(this.ctx(), path, deep)
  }

  /** 获取支持的文件类型（epub、pdf等） */
  async getSupportedFiles(path: string = '/'): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
    const result = await this.getDirectoryContents(path, true)
    if (!result.success || !result.data) return result
    return { success: true, data: filterSupportedFiles(result.data) }
  }

  /**
   * 获取文件内容
   * @param filePath 文件路径
   * @param format 返回格式
   */
  async getFileContents(
    filePath: string,
    format: 'text' | 'binary' = 'binary',
    opts?: ProgressOptions
  ): Promise<WebDAVOperationResult<string | ArrayBuffer>> {
    if (!this.config && !this.client) return { success: false, error: NOT_INITIALIZED }
    return getFileContents(this.ctx(), filePath, format, opts)
  }

  /**
   * 上传文件
   * @param filePath 目标文件路径
   * @param data 文件数据
   * @param overwrite 是否覆盖现有文件
   */
  async putFileContents(
    filePath: string,
    data: string | ArrayBuffer | Blob,
    overwrite: boolean = true
  ): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config && !this.client) return { success: false, error: NOT_INITIALIZED }
    return putFileContents(this.ctx(), filePath, data, overwrite)
  }

  /** 上传文件（putFileContents的别名方法） */
  async uploadFile(
    filePath: string,
    data: string | ArrayBuffer | Blob,
    overwrite: boolean = true
  ): Promise<WebDAVOperationResult<boolean>> {
    return this.putFileContents(filePath, data, overwrite)
  }

  /** 创建目录 */
  async createDirectory(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return this.runPathOp(path, '创建目录失败', (c) => c.createDirectory('/'))
  }

  /** 删除文件 */
  async deleteFile(filePath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return this.runPathOp(filePath, '删除文件失败', (c) => c.deleteFile('/'))
  }

  /** 删除目录 */
  async deleteDirectory(dirPath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return this.runPathOp(dirPath, '删除目录失败', (c) => c.deleteFile('/'))
  }

  /**
   * 存在性三态（契约 C4）：200/207→exists，404→missing；
   * 401/403/其他 4xx→unknown（不重试）；5xx/408/429/网络错误指数退避重试，仍失败→unknown；未初始化→unknown。
   * 代理自身错误（X-Proxy-Error）不当作上游状态：除 502 可重试外一律 unknown。
   * 调用方应把 unknown 当「不确定」，不要等同于不存在。
   */
  async existsStatus(path: string): Promise<DavExistsStatus> {
    return (await existsDetail(this.ctx(), path)).status
  }

  /**
   * 检查文件或目录是否存在（兼容接口，内部复用 existsDetail）
   * unknown 时 success=false 并带错误信息（含代理拒绝原因）
   */
  async exists(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    const { status, reason } = await existsDetail(this.ctx(), path)
    if (status === 'exists') return { success: true, data: true }
    if (status === 'missing') return { success: true, data: false }
    console.warn('[WebDAV] 检查路径失败:', path, reason)
    return { success: false, error: `检查路径失败: ${reason}` }
  }

  /** 简化的文件存在检查方法 */
  async fileExists(filePath: string): Promise<boolean> {
    const result = await this.exists(filePath)
    return result.success ? (result.data || false) : false
  }

  /** 获取文件或目录信息 */
  async getStat(path: string): Promise<WebDAVOperationResult<WebDAVFileInfo>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return getStat(this.ctx(), path)
  }

  /** 确保同步目录存在 */
  async ensureSyncDirectory(): Promise<WebDAVOperationResult<boolean>> {
    return ensureSyncDirectory(this)
  }

  /** 同步文件到WebDAV */
  async syncFiles(
    localFiles: Array<{ name: string, content: string | ArrayBuffer, path: string }>,
    onProgress?: UploadProgressCallback
  ): Promise<WebDAVOperationResult<boolean>> {
    return syncFiles(this, localFiles, onProgress)
  }

  /** 下载文件并转换为File对象（fileName 可选，用于避免特殊字符问题） */
  async downloadFileAsFile(filePath: string, fileName?: string, opts?: ProgressOptions): Promise<WebDAVOperationResult<File>> {
    if (!this.client) return { success: false, error: NOT_INITIALIZED }
    return downloadFileAsFile(this, filePath, fileName, opts)
  }

  /** 获取文件下载链接 */
  getFileDownloadLink(filePath: string): string {
    if (!this.client || !this.config) return ''

    try {
      return buildWebdavProxyUrl({
        baseUrl: this.config.serverUrl,
        folder: this.config.syncPath || '/',
        path: normalizeDavPath(filePath)
      })
    } catch {
      return ''
    }
  }

  /** 获取配置信息 */
  getConfig(): WebDAVConfig | null {
    return this.config
  }

  /** 检查是否已初始化 */
  isInitialized(): boolean {
    return this.client !== null && this.config !== null
  }

  /** 合并非凭据类配置（syncPath / browsePath 等），未初始化时忽略 */
  updateConfig(config: Partial<WebDAVConfig>): void {
    if (this.config) {
      this.config = { ...this.config, ...config }
    }
  }

  /** 断开连接 */
  disconnect(): void {
    this.client = null
    this.config = null
  }
}

// 创建单例实例
export const webdavService = new WebDAVService()
bindWebDAVServiceToStore(webdavService)
