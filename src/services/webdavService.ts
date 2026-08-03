import { createClient, WebDAVClient } from 'webdav'
import type { WebDAVConfig } from '../stores/configStore'
import { buildWebdavProxyUrl, buildWebdavPath, normalizeDavPath, encodeDavHeaderPath } from './webdavProxyUtils'
import { getMimeType, fileToArrayBuffer } from '../utils/file'


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

/**
 * 获取处理后的URL - 支持Cloudflare Pages Functions代理
 * @param originalUrl 原始URL
 * @returns 处理后的URL
 */
function getProcessedUrl(originalUrl: string): string {
  const isBrowser = typeof window !== 'undefined'
  if (isBrowser) {
    return '/api/dav'
  }

  return originalUrl
}


function buildHeaderPath(config: WebDAVConfig, path: string): string {
  // 返回未编码路径；编码统一在 setDavHeader → encodeDavHeaderPath 完成，避免双重 encode
  return buildWebdavPath({
    folder: config.browsePath || '/',
    path
  })
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function basicAuthHeader(username: string, password: string): string {
  // btoa 仅支持 latin1；密码含非 ASCII 时用 URI 转义兜底
  const raw = `${username}:${password}`
  try {
    return 'Basic ' + btoa(raw)
  } catch {
    const bin = encodeURIComponent(raw).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
    return 'Basic ' + btoa(bin)
  }
}

function toUploadBody(data: string | ArrayBuffer | Blob): {
  body: BodyInit
  byteLength?: number
} {
  if (typeof data === 'string') {
    const bytes = new TextEncoder().encode(data)
    return { body: bytes, byteLength: bytes.byteLength }
  }
  if (data instanceof ArrayBuffer) {
    return { body: data, byteLength: data.byteLength }
  }
  return { body: data }
}

// WebDAV客户端封装类
export class WebDAVService {
  private client: WebDAVClient | null = null
  private config: WebDAVConfig | null = null
  /**
   * 串行化所有依赖 X-WebDAV-Path 的请求。
   * 代理模式用共享 client 的可变 header 传真实路径，并发 Promise.all 会互相覆盖导致错读/假 404。
   */
  private opChain: Promise<unknown> = Promise.resolve()

  /**
   * 设置 WebDAV 请求头（自动编码路径）
   * @param path 路径（会被自动编码）
   */
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
    options?: {
      body?: BodyInit | null
      extraHeaders?: Record<string, string>
    }
  ): Promise<Response> {
    if (!this.config) {
      throw new Error('WebDAV配置未找到')
    }
    const normalizedPath = normalizeDavPath(filePath)
    const headerPath = buildHeaderPath(this.config, normalizedPath)
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(this.config.username, this.config.password),
      'X-WebDAV-Base': ensureTrailingSlash(this.config.serverUrl),
      'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
      'X-Request-Origin': window.location.origin,
      'Cache-Control': 'no-store, no-cache',
      Pragma: 'no-cache',
      ...(options?.extraHeaders || {}),
    }
    console.log(
      `[WebDAV:proxy] ${method} path=${headerPath} enc=${headers['X-WebDAV-Path'].slice(0, 80)}…`
    )
    return fetch('/api/dav/', {
      method,
      headers,
      body: options?.body ?? null,
    })
  }

  /**
   * 初始化WebDAV客户端
   * @param config WebDAV配置
   */
  async initialize(config: WebDAVConfig): Promise<WebDAVOperationResult<boolean>> {
    try {
      if (!config.serverUrl || !config.username || !config.password) {
        return {
          success: false,
          error: 'WebDAV_CONFIG_INCOMPLETE'
        }
      }

      // 已用相同凭据连上：跳过重建，避免处理中途 re-init 把 client 置空
      if (
        this.client &&
        this.config &&
        this.config.serverUrl === config.serverUrl &&
        this.config.username === config.username &&
        this.config.password === config.password
      ) {
        this.config = { ...this.config, ...config }
        return { success: true, data: true }
      }

      this.config = config

      // 获取处理后的URL（根据环境自动选择代理模式）
      const processedUrl = getProcessedUrl(config.serverUrl)

      // 创建WebDAV客户端
      const clientConfig: {
        username: string
        password: string
        headers?: Record<string, string>
      } = {
        username: config.username,
        password: config.password
      }

      // 检测移动端浏览器
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

      // 根据浏览器类型配置请求头
      clientConfig.headers = {
        'User-Agent': 'ebook-to-mindmap/1.0',
        'Accept': 'application/xml, text/xml, */*',
        'Cache-Control': 'no-store, no-cache',
        'Pragma': 'no-cache',
        'Authorization': basicAuthHeader(config.username, config.password),
        'X-WebDAV-Base': ensureTrailingSlash(config.serverUrl)
      }

      if (isMobile) {
        clientConfig.headers['X-Requested-With'] = 'XMLHttpRequest'
      }

      this.client = createClient(processedUrl, clientConfig)

      // 测试连接
      const testResult = await this.testConnection()
      if (!testResult.success) {
        this.client = null
        return testResult
      }

      return { success: true, data: true }
    } catch (error) {
      return {
        success: false,
        error: `WebDAV客户端初始化失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 测试WebDAV连接
   */
  async testConnection(): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const headerPath = '/'
        this.setDavHeader(headerPath)
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
        let errorMessage = '连接失败'

        if (error instanceof Error) {
          if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            errorMessage = '认证失败，请检查用户名和密码'
          } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
            errorMessage = '访问被拒绝，可能是权限问题或移动端兼容性问题'
          } else if (error.message.includes('404') || error.message.includes('Not Found')) {
            errorMessage = '服务器地址不正确'
          } else if (error.message.includes('405') || error.message.includes('Method Not Allowed')) {
            errorMessage = '请求方法不被支持，可能是代理配置问题'
          } else if (error.message.includes('ENOTFOUND') || error.message.includes('Network')) {
            errorMessage = '网络连接失败，请检查服务器地址'
          } else if (error.message.includes('CORS')) {
            errorMessage = 'CORS错误，请检查服务器配置'
          } else if (error.message.includes('invalid response')) {
            errorMessage = '响应格式无效，可能是代理服务器问题'
          } else {
            errorMessage = `连接失败: ${error.message}`
          }
        } else {
          console.error('WebDAV连接测试失败 - 未知错误:', error)
          errorMessage = '连接失败: 未知错误'
        }

        return { success: false, error: errorMessage }
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
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
    try {
      const rawPath = path || this.config?.browsePath || '/'
      const normalizedPath = normalizeDavPath(rawPath)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)

      this.setDavHeader(headerPath)

      const contents = await this.client!.getDirectoryContents('/', { deep })

      
      const contentList = Array.isArray(contents) ? contents : [contents]

      // 转换文件信息格式
      const fileList: WebDAVFileInfo[] = contentList.map(item => {
        let filename = String(item.filename ?? '')

        try {
          const itemUrl = new URL(filename)
          const baseUrl = new URL(this.config!.serverUrl)
          let relativePath = itemUrl.pathname
          const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`
          if (relativePath.startsWith(basePath)) {
            relativePath = relativePath.substring(basePath.length - 1)
          }
          filename = normalizeDavPath(relativePath)
        } catch {
          filename = normalizeDavPath(filename)
        }

        return {
          filename: filename,
          basename: item.basename,
          lastmod: item.lastmod,
          size: item.size || 0,
          type: item.type,
          etag: item.etag,
          mime: item.mime
        }
      })

      return { success: true, data: fileList }
    } catch (error) {
      return {
        success: false,
        error: `获取目录内容失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
    })
  }

  /**
   * 获取支持的文件类型（epub、pdf等）
   * @param path 目录路径
   */
  async getSupportedFiles(path: string = '/'): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
    const result = await this.getDirectoryContents(path, true)
    
    if (!result.success || !result.data) {
      return result
    }

    // 过滤出支持的文件类型
    const supportedExtensions = ['.epub', '.pdf', '.txt', '.md']
    const supportedFiles = result.data.filter(file => 
      file.type === 'file' && 
      supportedExtensions.some(ext => file.basename.toLowerCase().endsWith(ext))
    )

    return { success: true, data: supportedFiles }
  }

  /**
   * 获取文件内容
   * @param filePath 文件路径
   * @param format 返回格式
   */
  async getFileContents(
    filePath: string, 
    format: 'text' | 'binary' = 'binary'
  ): Promise<WebDAVOperationResult<string | ArrayBuffer>> {
    if (!this.config && !this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        if (!this.config) {
          return { success: false, error: 'WebDAV配置未找到' }
        }

        // 浏览器：同源代理直连 GET（路径只在 header，避免库内部 header 竞态）
        if (this.isBrowserProxyMode()) {
          const res = await this.proxyFetch('GET', filePath, {
            extraHeaders: { Accept: format === 'text' ? 'text/plain, */*' : '*/*' },
          })
          if (res.status === 404) {
            console.warn('[WebDAV] 文件不存在 (404):', filePath)
            return { success: false, error: `下载文件失败: Invalid response: 404 Not Found` }
          }
          if (!res.ok) {
            const t = await res.text().catch(() => '')
            return {
              success: false,
              error: `下载文件失败: Invalid response: ${res.status} ${res.statusText}${t ? ` ${t.slice(0, 80)}` : ''}`,
            }
          }
          if (format === 'text') {
            return { success: true, data: await res.text() }
          }
          return { success: true, data: await res.arrayBuffer() }
        }

        if (!this.client) {
          return { success: false, error: 'WebDAV客户端未初始化' }
        }

        const normalizedPath = normalizeDavPath(filePath)
        const headerPath = buildHeaderPath(this.config, normalizedPath)

        this.setDavHeader(headerPath)

        if (format === 'text') {
          const content = await this.client.getFileContents('/', {
            format: 'text',
            headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' }
          }) as string
          return { success: true, data: content }
        }

        const binaryContent = await this.client.getFileContents('/', {
          format: 'binary',
          headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' }
        })

        const arrayBuffer = await this.normalizeToArrayBuffer(binaryContent)

        return { success: true, data: arrayBuffer }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // 缓存未命中是常见情况（无完整摘要），用 warn 而非 error
        if (msg.includes('404') || msg.includes('Not Found') || msg.includes('Invalid response: 404')) {
          console.warn('[WebDAV] 文件不存在 (404):', filePath)
        } else {
          console.error('获取文件内容失败:', error)
        }
        return {
          success: false,
          error: `下载文件失败: ${msg}`
        }
      }
    })
  }

  /**
   * 直接下载（已弃用，仅在特殊情况下使用）
   * @param filePath 文件路径
   * @deprecated 由于CORS限制，建议使用代理下载
   */
  private async directDownload(filePath: string): Promise<WebDAVOperationResult<ArrayBuffer>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未找到' }
    }

    try {
      // 创建直接连接的客户端（不使用代理）
      const directClient = createClient(this.config.serverUrl, {
        username: this.config.username,
        password: this.config.password
      })

      const binaryContent = await directClient.getFileContents(filePath, { format: 'binary' })

      const arrayBuffer = await this.normalizeToArrayBuffer(binaryContent)

      return { success: true, data: arrayBuffer }

    } catch (error) {
      return {
        success: false,
        error: `直接下载失败: ${error instanceof Error ? error.message : '未知错误'}

提示：在开发环境下建议使用同源代理避免CORS问题。`
      }
    }
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
    if (!this.config && !this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        if (!this.config) {
          return { success: false, error: 'WebDAV配置未找到' }
        }

        const normalizedPath = normalizeDavPath(filePath)

        // 浏览器：代理直连 PUT（UTF-8 字节体 + 正确 Content-Length）
        if (this.isBrowserProxyMode()) {
          // 确保父目录存在（仍走 webdav 库的 MKCOL，失败不挡 PUT）
          const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
          if (dirPath && dirPath !== '/' && this.client) {
            try {
              const dirHeaderPath = buildHeaderPath(this.config, dirPath)
              this.setDavHeader(dirHeaderPath)
              const dirExists = await this.client.exists('/')
              if (!dirExists) {
                this.setDavHeader(dirHeaderPath)
                await this.client.createDirectory('/')
              }
            } catch (e) {
              console.warn('[WebDAV] 确保目录存在失败（继续 PUT）:', dirPath, e)
            }
          }

          const { body, byteLength } = toUploadBody(data)
          const extraHeaders: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
          }
          if (typeof byteLength === 'number') {
            extraHeaders['Content-Length'] = String(byteLength)
          }
          if (!overwrite) {
            extraHeaders['If-None-Match'] = '*'
          }

          const res = await this.proxyFetch('PUT', normalizedPath, {
            body,
            extraHeaders,
          })
          // 201 Created / 204 No Content / 200 OK 均视为成功
          if (res.status === 201 || res.status === 204 || res.status === 200 || res.ok) {
            console.log(`[WebDAV:proxy] PUT ok status=${res.status} path=${normalizedPath}`)
            return { success: true, data: true }
          }
          const errText = await res.text().catch(() => '')
          console.warn(
            `[WebDAV:proxy] PUT fail status=${res.status} path=${normalizedPath}`,
            errText.slice(0, 200)
          )
          return {
            success: false,
            error: `上传文件失败: Invalid response: ${res.status} ${res.statusText}${errText ? ` ${errText.slice(0, 120)}` : ''}`,
          }
        }

        if (!this.client) {
          return { success: false, error: 'WebDAV客户端未初始化' }
        }

        const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
        if (dirPath && dirPath !== '/') {
          const dirHeaderPath = buildHeaderPath(this.config, dirPath)
          this.setDavHeader(dirHeaderPath)
          const dirExists = await this.client.exists('/')
          if (!dirExists) {
            this.setDavHeader(dirHeaderPath)
            await this.client.createDirectory('/')
          }
        }

        const headerPath = buildHeaderPath(this.config, normalizedPath)
        this.setDavHeader(headerPath)
        const result = await this.client.putFileContents(
          '/',
          data as string | Buffer | ArrayBuffer | Blob,
          { overwrite }
        )

        return { success: true, data: result }
      } catch (error) {
        return {
          success: false,
          error: `上传文件失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }

  /**
   * 上传文件（putFileContents的别名方法）
   * @param filePath 文件路径
   * @param data 文件内容
   * @param overwrite 是否覆盖现有文件
   */
  async uploadFile(
    filePath: string,
    data: string | ArrayBuffer | Blob,
    overwrite: boolean = true
  ): Promise<WebDAVOperationResult<boolean>> {
    return this.putFileContents(filePath, data, overwrite)
  }

  /**
   * 创建目录
   * @param path 目录路径
   */
  async createDirectory(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const normalizedPath = normalizeDavPath(path)
        const headerPath = buildHeaderPath(this.config!, normalizedPath)
        this.setDavHeader(headerPath)
        await this.client!.createDirectory('/')
        return { success: true, data: true }
      } catch (error) {
        return {
          success: false,
          error: `创建目录失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }


  /**
   * 删除文件
   * @param filePath 文件路径
   */
  async deleteFile(filePath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const normalizedPath = normalizeDavPath(filePath)
        const headerPath = buildHeaderPath(this.config!, normalizedPath)
        this.setDavHeader(headerPath)
        await this.client!.deleteFile('/')
        return { success: true, data: true }
      } catch (error) {
        return {
          success: false,
          error: `删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }


  /**
   * 删除目录
   * @param dirPath 目录路径
   */
  async deleteDirectory(dirPath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const normalizedPath = normalizeDavPath(dirPath)
        const headerPath = buildHeaderPath(this.config!, normalizedPath)
        this.setDavHeader(headerPath)
        await this.client!.deleteFile('/')
        return { success: true, data: true }
      } catch (error) {
        return {
          success: false,
          error: `删除目录失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }


  /**
   * 检查文件或目录是否存在
   * @param path 路径
   */
  async exists(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const normalizedPath = normalizeDavPath(path)
        const headerPath = buildHeaderPath(this.config!, normalizedPath)

        this.setDavHeader(headerPath)

        const exists = await this.client!.exists('/')

        return { success: true, data: exists }
      } catch (error) {
        // 对于 404 错误，返回 false 而不是错误
        if (error instanceof Error && error.message.includes('404')) {
          return { success: true, data: false }
        }
        console.error('检查路径失败:', error)
        return {
          success: false,
          error: `检查路径失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }



  /**
   * 简化的文件存在检查方法
   * @param filePath 文件路径
   * @returns 文件是否存在
   */
  async fileExists(filePath: string): Promise<boolean> {
    const result = await this.exists(filePath)
    return result.success ? (result.data || false) : false
  }

  /**
   * 获取文件或目录信息
   * @param path 路径
   */
  async getStat(path: string): Promise<WebDAVOperationResult<WebDAVFileInfo>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    return this.runExclusive(async () => {
      try {
        const normalizedPath = normalizeDavPath(path)
        const headerPath = buildHeaderPath(this.config!, normalizedPath)
        this.setDavHeader(headerPath)
        const stat = await this.client!.stat('/')

        const statRecord = stat as Record<string, unknown>
        const fileInfo: WebDAVFileInfo = {
          filename: normalizedPath,
          basename:
            typeof statRecord.basename === 'string'
              ? statRecord.basename
              : normalizedPath.split('/').pop() || '',
          lastmod:
            typeof statRecord.lastmod === 'string'
              ? statRecord.lastmod
              : new Date().toISOString(),
          size: typeof statRecord.size === 'number' ? statRecord.size : 0,
          type: statRecord.type === 'directory' ? 'directory' : 'file',
          etag: typeof statRecord.etag === 'string' ? statRecord.etag : '',
          mime: typeof statRecord.mime === 'string' ? statRecord.mime : ''
        }

        return { success: true, data: fileInfo }
      } catch (error) {
        return {
          success: false,
          error: `获取文件信息失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }
    })
  }


  /**
   * 确保同步目录存在
   */
  async ensureSyncDirectory(): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    const syncPath = this.config.syncPath || '/fastReader'
    
    // 检查目录是否存在
    const existsResult = await this.exists(syncPath)
    if (!existsResult.success) {
      return existsResult
    }

    if (!existsResult.data) {
      // 创建目录
      return await this.createDirectory(syncPath)
    }

    return { success: true, data: true }
  }

  /**
   * 同步文件到WebDAV
   * @param localFiles 本地文件列表
   * @param onProgress 进度回调
   */
  async syncFiles(
    localFiles: Array<{ name: string, content: string | ArrayBuffer, path: string }>,
    onProgress?: UploadProgressCallback
  ): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client || !this.config) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      // 确保同步目录存在
      const ensureDirResult = await this.ensureSyncDirectory()
      if (!ensureDirResult.success) {
        return ensureDirResult
      }

      const syncPath = this.config.syncPath || '/fastReader'
      let successCount = 0

      for (let i = 0; i < localFiles.length; i++) {
        const file = localFiles[i]
        const remotePath = `${syncPath}/${file.path || file.name}`

        const uploadResult = await this.putFileContents(remotePath, file.content, true)
        if (uploadResult.success) {
          successCount++
        }

        // 调用进度回调
        if (onProgress) {
          onProgress((i + 1) / localFiles.length)
        }
      }

      if (successCount === localFiles.length) {
        return { success: true, data: true }
      } else {
        return {
          success: false,
          error: `部分文件上传失败 (${successCount}/${localFiles.length})`
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `同步文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 下载文件并转换为File对象
   * @param filePath 文件路径
   * @param fileName 文件名（可选，用于避免特殊字符问题）
   */
  async downloadFileAsFile(filePath: string, fileName?: string): Promise<WebDAVOperationResult<File>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      // 标准化文件路径
      let normalizedPath = filePath
      if (normalizedPath.startsWith('../dav/')) {
        normalizedPath = normalizedPath.replace('../dav/', '/')
      }
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath
      }

      // 获取文件内容
      const contentResult = await this.getFileContents(normalizedPath, 'binary')
      if (!contentResult.success || !contentResult.data) {
        return {
          success: false,
          error: contentResult.error || '获取文件内容失败'
        }
      }

      // 使用提供的文件名或从路径中提取
      const finalFileName = fileName || normalizedPath.split('/').pop() || 'downloaded_file'

      // 创建File对象
      const file = new File([contentResult.data], finalFileName, {
        type: getMimeType(finalFileName)
      })

      return { success: true, data: file }
    } catch (error) {
      return {
        success: false,
        error: `下载文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 将 WebDAV 返回内容统一转换为 ArrayBuffer
   */
  private async normalizeToArrayBuffer(content: unknown): Promise<ArrayBuffer> {
    if (content instanceof ArrayBuffer) {
      return content
    }

    if (ArrayBuffer.isView(content)) {
      const view = content as ArrayBufferView
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
    }

    if (content instanceof Blob) {
      return fileToArrayBuffer(new File([content], 'webdav-download.bin'))
    }

    if (typeof content === 'string') {
      const binaryString = atob(content)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes.buffer
    }

    if (typeof Buffer !== 'undefined' && content instanceof Buffer) {
      const uint8Array = new Uint8Array(content)
      return uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) as ArrayBuffer
    }

    const uint8Array = new Uint8Array(content as ArrayBufferLike)
    return uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) as ArrayBuffer
  }

  /**
   * 获取文件下载链接
   * @param filePath 文件路径
   */
  getFileDownloadLink(filePath: string): string {
    if (!this.client || !this.config) {
      return ''
    }

    try {
      const normalizedPath = normalizeDavPath(filePath)
      return buildWebdavProxyUrl({
        baseUrl: this.config.serverUrl,
        folder: this.config.syncPath || '/',
        path: normalizedPath
      })
    } catch {
      return ''
    }
  }


  /**
   * 获取配置信息
   */
  getConfig(): WebDAVConfig | null {
    return this.config
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.client !== null && this.config !== null
  }



  /**
   * 断开连接
   */
  disconnect(): void {
    this.client = null
    this.config = null
  }
}

// 创建单例实例
export const webdavService = new WebDAVService()

// 导出类型和工具函数
export type { WebDAVConfig } from '../stores/configStore'
