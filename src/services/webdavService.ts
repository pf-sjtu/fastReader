import { createClient, WebDAVClient } from 'webdav'
import type { WebDAVConfig } from '../stores/configStore'
import { buildWebdavProxyUrl, buildWebdavPath, normalizeDavPath, encodeDavHeaderPath } from './webdavProxyUtils'


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

export interface WebDAVOperationResult<T = any> {
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

function buildProxyBaseUrl(config: WebDAVConfig): string {
  return buildWebdavProxyUrl({
    baseUrl: config.serverUrl,
    folder: config.browsePath || '/',
    path: '/'
  })
}

function buildHeaderPath(config: WebDAVConfig, path: string): string {
  return buildWebdavPath({
    folder: config.browsePath || '/',
    path
  })
}


// WebDAV客户端封装类
export class WebDAVService {
  private client: WebDAVClient | null = null
  private config: WebDAVConfig | null = null

  /**
   * 初始化WebDAV客户端
   * @param config WebDAV配置
   */
  async initialize(config: WebDAVConfig): Promise<WebDAVOperationResult<boolean>> {
    try {
      this.config = config
      
      if (!config.serverUrl || !config.username || !config.password) {
        return {
          success: false,
          error: 'WebDAV配置不完整，需要服务器地址、用户名和密码'
        }
      }

      // 获取处理后的URL（根据环境自动选择代理模式）
      const processedUrl = getProcessedUrl(config.serverUrl)
      const proxyMode = typeof window !== 'undefined' ? 'Cloudflare Pages Functions' : '直连'
      console.log('初始化WebDAV客户端，原始URL:', config.serverUrl)
      console.log('初始化WebDAV客户端，处理后URL:', processedUrl)
      console.log('代理模式:', proxyMode)

      // 创建WebDAV客户端
      const clientConfig: any = {
        username: config.username,
        password: config.password
      }

      
      // 检测移动端浏览器
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      console.log('移动端浏览器检测:', isMobile)
      
      // 根据浏览器类型配置请求头
      clientConfig.headers = {
        'User-Agent': 'ebook-to-mindmap/1.0',
        'Accept': 'application/xml, text/xml, */*'
      }
      
      if (isMobile) {
        clientConfig.headers['X-Requested-With'] = 'XMLHttpRequest'
        clientConfig.headers['Cache-Control'] = 'no-cache'
      }

      clientConfig.headers = {
        ...clientConfig.headers,
        'Authorization': 'Basic ' + btoa(`${config.username}:${config.password}`),
        'X-WebDAV-Base': config.serverUrl
      }

      
      console.log('WebDAV客户端配置:', {
        url: processedUrl,
        hasHeaders: !!clientConfig.headers,
        headerKeys: clientConfig.headers ? Object.keys(clientConfig.headers) : [],
        isMobile: isMobile
      })
      
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

    try {
      // 检测移动端环境
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      
      console.log('测试WebDAV连接...', {
        isMobile: isMobile,
        userAgent: navigator.userAgent
      })
      
      const headerPath = '/'
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      await this.client.getDirectoryContents('/')

      if (this.config?.syncPath) {
        const normalizedSyncPath = normalizeDavPath(this.config.syncPath)
        if (normalizedSyncPath !== '/') {
          this.client.setHeaders({
            ...this.client.getHeaders(),
            'X-WebDAV-Path': encodeDavHeaderPath(normalizedSyncPath),
            'X-Request-Origin': window.location.origin
          })

          const exists = await this.client.exists('/')
          if (!exists) {
            await this.client.createDirectory('/')
          }
        }
      }

      console.log('WebDAV连接测试成功')
      return { success: true, data: true }

    } catch (error) {
      let errorMessage = '连接失败'
      
      if (error instanceof Error) {
        console.error('WebDAV连接测试失败:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        })
        
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

    try {
      const rawPath = path || this.config?.browsePath || '/'
      console.log('请求目录内容，路径:', rawPath)
      console.log('当前WebDAV客户端配置:', {
        baseURL: this.config?.serverUrl,
        processedURL: getProcessedUrl(this.config?.serverUrl || '')
      })
      const normalizedPath = normalizeDavPath(rawPath)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)

      console.log('标准化后路径:', normalizedPath)
      console.log('即将发送WebDAV请求到基础URL:', buildProxyBaseUrl(this.config!))
      
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })

      const contents = await this.client.getDirectoryContents('/', { deep })

      
      // 转换文件信息格式
      const fileList: WebDAVFileInfo[] = (contents as any[]).map(item => {
        let filename = item.filename

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


      console.log('返回文件列表:', fileList.map(f => ({ name: f.basename, filename: f.filename })))
      return { success: true, data: fileList }
    } catch (error) {
      console.error('获取目录内容失败:', error)
      return {
        success: false,
        error: `获取目录内容失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
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
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      console.log('获取文件内容:', filePath, '格式:', format)
      
      if (!this.config) {
        return { success: false, error: 'WebDAV配置未找到' }
      }

      const normalizedPath = normalizeDavPath(filePath)
      const headerPath = buildHeaderPath(this.config, normalizedPath)

      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })

      if (format === 'text') {
        const content = await this.client.getFileContents('/', { format: 'text' }) as string
        return { success: true, data: content }
      }

      const binaryContent = await this.client.getFileContents('/', { format: 'binary' })
      console.log('WebDAV客户端返回的内容类型:', typeof binaryContent, binaryContent.constructor.name)

      let arrayBuffer: ArrayBuffer
      if (binaryContent instanceof ArrayBuffer) {
        arrayBuffer = binaryContent
      } else if (binaryContent instanceof Uint8Array) {
        arrayBuffer = binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength) as ArrayBuffer
      } else if (typeof binaryContent === 'string') {
        arrayBuffer = this.base64ToArrayBuffer(binaryContent)
      } else {
        const uint8Array = binaryContent instanceof Buffer ?
          new Uint8Array(binaryContent) :
          new Uint8Array(binaryContent as unknown as ArrayBufferLike)
        arrayBuffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) as ArrayBuffer
      }

      return { success: true, data: arrayBuffer }

    } catch (error) {
      console.error('获取文件内容失败:', error)
      return {
        success: false,
        error: `下载文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 直接下载（已弃用，仅在特殊情况下使用）
   * @param filePath 文件路径
   * @deprecated 由于CORS限制，建议使用代理下载
   */
  private async directDownload(filePath: string): Promise<WebDAVOperationResult<ArrayBuffer>> {
    console.warn('⚠️ 使用已弃用的直接下载方法，可能存在CORS问题')
    
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未找到' }
    }

    try {
      console.log('创建直接 WebDAV 客户端连接...')
      
      // 创建直接连接的客户端（不使用代理）
      const directClient = createClient(this.config.serverUrl, {
        username: this.config.username,
        password: this.config.password
      })
      
      console.log('使用直接客户端下载文件:', filePath)
      const binaryContent = await directClient.getFileContents(filePath, { format: 'binary' })
      
      console.log('直接下载成功，内容类型:', typeof binaryContent, binaryContent.constructor.name)
      console.log('直接下载大小:', 
        (binaryContent as ArrayBuffer).byteLength || (binaryContent as Uint8Array).length || (binaryContent as string).length || 0)
      
      // 转换为 ArrayBuffer
      let arrayBuffer: ArrayBuffer
      if (binaryContent instanceof ArrayBuffer) {
        arrayBuffer = binaryContent
      } else if (binaryContent instanceof Uint8Array) {
        arrayBuffer = binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength) as ArrayBuffer
      } else if (typeof binaryContent === 'string') {
        arrayBuffer = this.base64ToArrayBuffer(binaryContent)
      } else {
        // 处理Buffer或其他类型
        const uint8Array = binaryContent instanceof Buffer ? 
          new Uint8Array(binaryContent) : 
          new Uint8Array(binaryContent as unknown as ArrayBufferLike)
        arrayBuffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) as ArrayBuffer
      }
      
      return { success: true, data: arrayBuffer }
      
    } catch (error) {
      console.error('直接下载失败:', error)
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
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      console.log('🔄 WebDAV上传文件:')
      console.log('   文件路径:', filePath)
      console.log('   数据类型:', typeof data)
      console.log('   数据大小:', typeof data === 'string' ? data.length : 'unknown')
      console.log('   覆盖模式:', overwrite)
      
      const normalizedPath = normalizeDavPath(filePath)

      const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
      if (dirPath && dirPath !== '/') {
        console.log('📁 检查目录是否存在:', dirPath)
        const dirHeaderPath = buildHeaderPath(this.config!, dirPath)
        this.client.setHeaders({
          ...this.client.getHeaders(),
          'X-WebDAV-Path': dirHeaderPath
        })
        const dirExists = await this.client.exists('/')
        if (!dirExists) {
          console.log('📁 创建目录:', dirPath)
          this.client.setHeaders({
            ...this.client.getHeaders(),
            'X-WebDAV-Path': dirHeaderPath
          })
          await this.client.createDirectory('/')
        }
      }
      
      const headerPath = buildHeaderPath(this.config!, normalizedPath)
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      const result = await this.client.putFileContents('/', data as any, { overwrite })
      
      console.log('✅ WebDAV上传成功:', result)
      return { success: true, data: result }

    } catch (error) {
      console.error('❌ WebDAV上传失败:', error)
      return {
        success: false,
        error: `上传文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
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

    try {
      const normalizedPath = normalizeDavPath(path)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      await this.client.createDirectory('/')
      return { success: true, data: true }
    } catch (error) {
      return {
        success: false,
        error: `创建目录失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }


  /**
   * 删除文件
   * @param filePath 文件路径
   */
  async deleteFile(filePath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      const normalizedPath = normalizeDavPath(filePath)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      await this.client.deleteFile('/')
      return { success: true, data: true }
    } catch (error) {
      return {
        success: false,
        error: `删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }


  /**
   * 删除目录
   * @param dirPath 目录路径
   */
  async deleteDirectory(dirPath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      const normalizedPath = normalizeDavPath(dirPath)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      await this.client.deleteFile('/')
      return { success: true, data: true }
    } catch (error) {
      return {
        success: false,
        error: `删除目录失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }


  /**
   * 检查文件或目录是否存在
   * @param path 路径
   */
  async exists(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      const normalizedPath = normalizeDavPath(path)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)

      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })

      const exists = await this.client.exists('/')

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

    try {
      const normalizedPath = normalizeDavPath(path)
      const headerPath = buildHeaderPath(this.config!, normalizedPath)
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })
      const stat = await this.client.stat('/')
      
      const fileInfo: WebDAVFileInfo = {
        filename: normalizedPath,
        basename: (stat as any).basename || normalizedPath.split('/').pop() || '',
        lastmod: (stat as any).lastmod || new Date().toISOString(),
        size: (stat as any).size || 0,
        type: (stat as any).type || 'file',
        etag: (stat as any).etag || '',
        mime: (stat as any).mime || ''
      }

      return { success: true, data: fileInfo }
    } catch (error) {
      return {
        success: false,
        error: `获取文件信息失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
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
      console.log('开始下载文件:', filePath, fileName)
      
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
        console.error('获取文件内容失败:', contentResult.error)
        return {
          success: false,
          error: contentResult.error || '获取文件内容失败'
        }
      }

      console.log('文件内容获取成功，类型:', typeof contentResult.data, '长度:', 
        (contentResult.data as ArrayBuffer).byteLength || (contentResult.data as string).length || 'unknown')
      
      // 使用提供的文件名或从路径中提取
      const finalFileName = fileName || normalizedPath.split('/').pop() || 'downloaded_file'
      
      // 创建File对象
      const file = new File([contentResult.data], finalFileName, {
        type: this.getMimeType(finalFileName)
      })

      console.log('File对象创建成功:', file.name, '大小:', file.size, '类型:', file.type)
      
      return { success: true, data: file }
    } catch (error) {
      console.error('下载文件异常:', error)
      return {
        success: false,
        error: `下载文件失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * Base64 字符串转 ArrayBuffer
   * @param base64 Base64 编码的字符串
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }

  /**
   * 获取文件MIME类型
   * @param fileName 文件名
   */
  private getMimeType(fileName: string): string {
    const extension = fileName.toLowerCase().split('.').pop()
    switch (extension) {
      case 'pdf':
        return 'application/pdf'
      case 'epub':
        return 'application/epub+zip'
      case 'txt':
        return 'text/plain'
      case 'md':
        return 'text/markdown'
      default:
        return 'application/octet-stream'
    }
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
    } catch (_error) {
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
