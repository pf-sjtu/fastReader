import { createClient, WebDAVClient } from 'webdav'
import { buildWebdavProxyUrl, normalizeDavPath, encodeDavHeaderPath } from './webdavProxyUtils'


// WebDAV操作结果接口
export interface WebDAVOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

// WebDAV文件信息接口
export interface WebDAVFileInfo {
  filename: string
  basename: string
  lastmod: Date
  size: number
  type: 'file' | 'directory'
  etag?: string
}

// WebDAV配置接口
export interface WebDAVConfig {
  enabled: boolean
  serverUrl: string
  username: string
  password: string
  appName: string
  autoSync: boolean
  syncPath: string
  browsePath: string
  lastSyncTime: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'


}

/**
 * 获取代理后的URL
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
  const normalizedPath = normalizeDavPath(path)
  if (normalizedPath === '/') {
    return normalizeDavPath(config.browsePath || '/')
  }

  const normalizedFolder = normalizeDavPath(config.browsePath || '/')
  if (normalizedFolder === '/') {
    return normalizedPath
  }

  return `${normalizedFolder}/${normalizedPath.replace(/^\//, '')}`
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
      
      clientConfig.headers = {
        Accept: 'application/xml, text/xml, */*'
      }
      
      if (isMobile) {
        clientConfig.headers['X-Requested-With'] = 'XMLHttpRequest'
        clientConfig.headers['Cache-Control'] = 'no-cache'
        clientConfig.headers['Pragma'] = 'no-cache'
      }

      clientConfig.headers = {
        ...clientConfig.headers,
        Authorization: 'Basic ' + btoa(`${config.username}:${config.password}`),
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

      
      const rootHeaderPath = '/'
      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(rootHeaderPath)
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
      console.error('WebDAV连接测试失败:', error)
      let errorMessage = '连接失败'
      
      if (error instanceof Error) {
        if (error.message.includes('403') || error.message.includes('Forbidden')) {
          errorMessage = '访问被拒绝，可能是权限问题或移动端兼容性问题'
        } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          errorMessage = '认证失败，请检查用户名和密码'
        } else if (error.message.includes('404') || error.message.includes('Not Found')) {
          errorMessage = '服务器地址不正确'
        } else {
          errorMessage = `连接失败: ${error.message}`
        }
      }
      
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 获取目录内容
   * @param path 目录路径
   * @param deep 是否递归获取子目录
   */
  async getDirectoryContents(path: string = '/', deep: boolean = false): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
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
      console.log('即将发送WebDAV请求到基础URL:', getProcessedUrl(this.config?.serverUrl || ''))

      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(headerPath),
        'X-Request-Origin': window.location.origin
      })

      const contents = await this.client.getDirectoryContents('/', { deep })

      
      const fileInfos: WebDAVFileInfo[] = (contents as any[]).map(item => {
        let filename = item.filename
        console.log('[getDirectoryContents] 原始filename:', filename)

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
          lastmod: new Date(item.lastmod),
          size: item.size,
          type: item.type,
          etag: item.etag
        }
      })


      console.log('返回文件列表:', fileInfos)
      return { success: true, data: fileInfos }
    } catch (error) {
      console.error('获取目录内容失败:', error)
      return {
        success: false,
        error: `获取目录内容失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取支持的文件类型（md、txt等）
   * @param path 目录路径
   */
  async getSupportedFiles(path: string = '/'): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
    const result = await this.getDirectoryContents(path || this.config?.browsePath || '/', true)

    
    if (!result.success || !result.data) {
      return result
    }

    // 过滤出支持的文件类型
    const supportedExtensions = ['.md', '.markdown', '.txt']
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
    format: 'text' | 'binary' = 'text'
  ): Promise<WebDAVOperationResult<string | ArrayBuffer>> {
    if (!this.client) {
      return { success: false, error: 'WebDAV客户端未初始化' }
    }

    try {
      console.log('获取文件内容:', filePath, '格式:', format)
      
      const normalizedPath = normalizeDavPath(filePath)

      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(normalizedPath)
      })

      if (format === 'text') {
        const content = await this.client.getFileContents('/', { format: 'text' }) as string
        return { success: true, data: content }
      }

      const binaryContent = await this.client.getFileContents('/', { format: 'binary' })
      console.log('WebDAV客户端返回的内容类型:', typeof binaryContent, binaryContent.constructor.name)
      console.log('内容长度:', (binaryContent as any).length || (binaryContent as any).byteLength)

      let arrayBuffer: ArrayBuffer
      if (binaryContent instanceof ArrayBuffer) {
        arrayBuffer = binaryContent
      } else if (binaryContent instanceof Uint8Array) {
        arrayBuffer = binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength) as ArrayBuffer
      } else if (typeof binaryContent === 'string') {
        arrayBuffer = this.base64ToArrayBuffer(binaryContent)
      } else {
        arrayBuffer = (binaryContent as any) instanceof Buffer ? (binaryContent as any).buffer : new Uint8Array(binaryContent as any).buffer
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
      
      // 获取文件内容 - 使用文本格式
      const contentResult = await this.getFileContents(normalizedPath, 'text')
      if (!contentResult.success || !contentResult.data) {
        console.error('获取文件内容失败:', contentResult.error)
        return {
          success: false,
          error: contentResult.error || '获取文件内容失败'
        }
      }

      console.log('文件内容获取成功，长度:', (contentResult.data as string).length)
      
      // 使用提供的文件名或从路径中提取
      const finalFileName = fileName || normalizedPath.split('/').pop() || 'downloaded_file.md'
      
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
   * @private
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
      case 'md':
      case 'markdown':
        return 'text/markdown'
      case 'txt':
        return 'text/plain'
      case 'json':
        return 'application/json'
      case 'pdf':
        return 'application/pdf'
      case 'epub':
        return 'application/epub+zip'
      default:
        return 'application/octet-stream'
    }
  }

  /**
   * 上传文件到WebDAV
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
      console.log('上传文件到WebDAV:', filePath)
      
      const normalizedPath = normalizeDavPath(filePath)

      const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
      if (dirPath && dirPath !== '/') {
        this.client.setHeaders({
          ...this.client.getHeaders(),
          'X-WebDAV-Path': encodeDavHeaderPath(dirPath)
        })
        const dirExists = await this.client.exists('/')
        if (!dirExists) {
          await this.client.createDirectory('/')
        }
      }

      this.client.setHeaders({
        ...this.client.getHeaders(),
        'X-WebDAV-Path': encodeDavHeaderPath(normalizedPath)
      })

      const result = await this.client.putFileContents('/', data as any, { overwrite })

      
      console.log('WebDAV上传成功:', result)
      return { success: true, data: result }
    } catch (error) {
      console.error('WebDAV上传失败:', error)
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
   * 检查文件是否存在
   * @param filePath 文件路径
   */
  async exists(filePath: string): Promise<boolean> {
    if (!this.client) {
      return false
    }

    try {
      return await this.client.exists(filePath)
    } catch (error) {
      console.error('检查文件存在性失败:', error)
      return false
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.client = null
    this.config = null
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.client !== null
  }
}

// 创建单例实例
export const webdavService = new WebDAVService()
