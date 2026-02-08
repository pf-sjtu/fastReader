// WebDAV代理服务 - 通过后端API处理WebDAV请求
export interface WebDAVProxyConfig {
  serverUrl: string
  username: string
  password: string
  appName: string
}

export interface WebDAVFileInfo {
  filename: string
  basename: string
  lastmod: string
  size: number
  type: 'file' | 'directory'
  etag?: string
  mime?: string
}

export interface WebDAVOperationResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export class WebDAVProxyService {
  private config: WebDAVProxyConfig | null = null
  private apiBaseUrl: string

  constructor(apiBaseUrl: string = '/api/dav') {
    this.apiBaseUrl = apiBaseUrl
  }


  /**
   * 设置WebDAV配置
   */
  setConfig(config: WebDAVProxyConfig) {
    this.config = config
  }

  /**
   * 获取当前配置
   */
  getConfig(): WebDAVProxyConfig | null {
    return this.config
  }

  /**
   * 测试WebDAV连接
   */
  async testConnection(): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.config),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `连接测试失败 (${response.status})`
        }
      }

      return { success: true, data: result.success }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取目录内容
   */
  async getDirectoryContents(
    path: string = '/',
    deep: boolean = false
  ): Promise<WebDAVOperationResult<WebDAVFileInfo[]>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          path,
          deep
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `获取目录失败 (${response.status})`
        }
      }

      return { success: true, data: result.files }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取支持的文件类型
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
   * 下载文件内容
   */
  async getFileContents(filePath: string): Promise<WebDAVOperationResult<ArrayBuffer>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          filePath
        }),
      })

      if (!response.ok) {
        const errorResult = await response.json()
        return {
          success: false,
          error: errorResult.error || `下载失败 (${response.status})`
        }
      }

      // 返回ArrayBuffer
      const arrayBuffer = await response.arrayBuffer()
      return { success: true, data: arrayBuffer }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 上传文件
   */
  async putFileContents(
    filePath: string,
    data: ArrayBuffer,
    overwrite: boolean = true
  ): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const formData = new FormData()
      formData.append('config', JSON.stringify(this.config))
      formData.append('filePath', filePath)
      formData.append('overwrite', overwrite.toString())
      formData.append('file', new Blob([data]))

      const response = await fetch(`${this.apiBaseUrl}/upload`, {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `上传失败 (${response.status})`
        }
      }

      return { success: true, data: result.success }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 创建目录
   */
  async createDirectory(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/create-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          path
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `创建目录失败 (${response.status})`
        }
      }

      return { success: true, data: result.success }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          filePath
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `删除失败 (${response.status})`
        }
      }

      return { success: true, data: result.success }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 检查文件或目录是否存在
   */
  async exists(path: string): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/exists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          path
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `检查路径失败 (${response.status})`
        }
      }

      return { success: true, data: result.exists }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取文件或目录信息
   */
  async getStat(path: string): Promise<WebDAVOperationResult<WebDAVFileInfo>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/stat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.config,
          path
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        return {
          success: false,
          error: result.error || `获取文件信息失败 (${response.status})`
        }
      }

      return { success: true, data: result.stat }
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 同步文件到WebDAV
   */
  async syncFiles(
    localFiles: Array<{ name: string, content: ArrayBuffer, path: string }>,
    onProgress?: (progress: number) => void
  ): Promise<WebDAVOperationResult<boolean>> {
    if (!this.config) {
      return { success: false, error: 'WebDAV配置未设置' }
    }

    try {
      let successCount = 0

      for (let i = 0; i < localFiles.length; i++) {
        const file = localFiles[i]
        const remotePath = `${this.config.appName || 'fastReader'}/${file.path || file.name}`

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
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.config !== null
  }

  /**
   * 清除配置
   */
  clearConfig() {
    this.config = null
  }
}

// 创建单例实例
export const webdavProxyService = new WebDAVProxyService()
