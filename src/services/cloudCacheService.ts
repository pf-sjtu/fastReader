import { webdavService } from './webdavService'
import { useConfigStore } from '../stores/configStore'

/**
 * 云端缓存文件信息
 */
export interface CloudCacheFile {
  fileName: string
  path: string
  size: number
  lastmod: string
}

/**
 * 缓存读取结果
 */
export interface CacheReadResult {
  success: boolean
  content?: string
  metadata?: ProcessingMetadata
  error?: string
}

/**
 * 处理元数据接口（用于解析 HTML 备注）
 */
export interface ProcessingMetadata {
  source: string
  fileName: string
  processedAt: string
  model: string
  chapterDetectionMode: string
  selectedChapters: string
  chapterCount: number
  originalCharCount: number
  processedCharCount: number
  inputTokens: number
  outputTokens: number
  costUSD: number
  costRMB: number
  skippedChapters?: number
  selectedChapterCount?: number
  isPartial?: boolean
}


/**
 * 云端缓存服务
 * 负责从 WebDAV 读取已处理的文件缓存
 */
export class CloudCacheService {
  private webdavService = webdavService

  /**
   * 生成缓存文件名
   * 规则：移除扩展名，移除特殊字符，保留多语言字符
   * @param fileName 原始文件名
   * @returns 缓存文件名（不含扩展名时添加 -完整摘要.md）
   */
  sanitizeFileName(fileName: string): string {
    // 移除文件扩展名
    const withoutExt = fileName.replace(/\.[^/.]+$/, '')

    // 移除特殊字符（Windows 不允许的字符）
    const sanitized = withoutExt
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    return sanitized
  }

  /**
   * 生成完整的缓存文件路径
   * @param fileName 原始文件名
   * @returns 完整的缓存文件路径
   */
  getCacheFilePath(fileName: string): string {
    const cacheFileName = this.getCacheFileName(fileName)
    const webdavConfig = useConfigStore.getState().webdavConfig
    const syncPath = webdavConfig.syncPath || '/fastReader'

    return `${syncPath}/${cacheFileName}`
  }

  /**
   * 生成缓存文件名
   * @param fileName 原始文件名
   * @returns 缓存文件名（{sanitizedName}-完整摘要.md）
   */
  getCacheFileName(fileName: string): string {
    const sanitizedName = this.sanitizeFileName(fileName)
    return `${sanitizedName}-完整摘要.md`
  }


  /**
   * 检查缓存是否存在
   * @param fileName 原始文件名
   * @returns 缓存是否存在
   */
  async checkCacheExists(fileName: string): Promise<boolean> {
    try {
      const cachePath = this.getCacheFilePath(fileName)
      const exists = await this.webdavService.fileExists(cachePath)
      console.log(`[CloudCache] 检查缓存是否存在: ${cachePath} -> ${exists}`)
      return exists
    } catch (error) {
      console.error('[CloudCache] 检查缓存失败:', error)
      return false
    }
  }

  /**
   * 基于已获取的缓存文件名集合进行本地判断
   */
  isCachedByFileName(fileName: string, cachedFileNames: Set<string>): boolean {
    return cachedFileNames.has(this.getCacheFileName(fileName))
  }


  /**
   * 读取缓存文件内容
   * @param fileName 原始文件名
   * @returns 缓存读取结果
   */
  async readCache(fileName: string): Promise<CacheReadResult> {
    try {
      const cachePath = this.getCacheFilePath(fileName)
      console.log(`[CloudCache] 读取缓存: ${cachePath}`)

      // 下载文件
      const downloadResult = await this.webdavService.getFileContents(cachePath, 'text')

      if (!downloadResult.success || !downloadResult.data) {
        return {
          success: false,
          error: downloadResult.error || '下载缓存文件失败'
        }
      }

      const content = downloadResult.data as string

      // 解析元数据
      const metadata = this.parseMetadata(content)

      return {
        success: true,
        content,
        metadata: metadata || undefined
      }
    } catch (error) {
      console.error('[CloudCache] 读取缓存失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }


  /**
   * 解析文件中的 HTML 备注
   * @param content 文件内容
   * @returns 解析出的元数据或 null
   */
  parseMetadata(content: string): ProcessingMetadata | null {
    try {
      // 匹配文件头部的 HTML 注释
      const commentMatch = content.match(/<!--\s*\n([\s\S]*?)\n-->/)

      if (!commentMatch) {
        return null
      }

      const commentContent = commentMatch[1]
      const metadata: ProcessingMetadata = {
        source: '',
        fileName: '',
        processedAt: '',
        model: '',
        chapterDetectionMode: '',
        selectedChapters: '',
        chapterCount: 0,
        originalCharCount: 0,
        processedCharCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
        costRMB: 0,
        skippedChapters: 0,
        selectedChapterCount: 0,
        isPartial: false
      }


      // 解析各字段
      const lines = commentContent.split('\n')
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':')
        if (!key || !valueParts.length) continue

        const value = valueParts.join(':').trim()
        const trimmedKey = key.trim() as keyof ProcessingMetadata

        switch (trimmedKey) {
          case 'source':
          case 'fileName':
          case 'processedAt':
          case 'model':
          case 'chapterDetectionMode':
          case 'selectedChapters':
            metadata[trimmedKey] = value
            break
          case 'chapterCount':
          case 'originalCharCount':
          case 'processedCharCount':
          case 'inputTokens':
          case 'outputTokens':
            metadata[trimmedKey] = parseInt(value, 10) || 0
            break
          case 'costUSD':
          case 'costRMB':
            metadata[trimmedKey] = parseFloat(value) || 0
            break
          case 'skippedChapters':
            metadata.skippedChapters = parseInt(value, 10) || 0
            break
          case 'selectedChapterCount':
            metadata.selectedChapterCount = parseInt(value, 10) || 0
            break
          case 'isPartial':
            metadata.isPartial = value === 'true'
            break
        }
      }


      return metadata
    } catch (error) {
      console.error('[CloudCache] 解析元数据失败:', error)
      return null
    }
  }

  /**
   * 从缓存内容提取纯 Markdown（不含备注）
   * @param content 包含备注的文件内容
   * @returns 纯 Markdown 内容
   */
  stripMetadata(content: string): string {
    // 移除文件头部的 HTML 注释
    return content.replace(/<!--\s*\n[\s\S]*?\n-->\n*/, '')
  }

  /**
   * 解析统一格式的 Markdown 内容
   *
   * 统一格式规范：
   * 1. HTML 注释格式的头部元数据
   * 2. 书名用一级标题 `# 书名`
   * 3. 作者信息（如有）
   * 4. 全书总结用二级标题 `## 全书总结`
   * 5. 章节关联用二级标题 `## 章节关联分析`
   * 6. 章节摘要用二级标题 `## 章节摘要`
   * 7. 各章节用三级标题 `### 第X章 章节名`
   *
   * @param content Markdown 内容
   * @returns 解析后的数据对象
   */
  parseUnifiedContent(content: string): {
    metadata: ProcessingMetadata | null
    title: string
    author: string
    overallSummary: string
    connections: string
    chapters: Array<{ title: string; summary: string }>
  } {
    // 解析元数据
    const metadata = this.parseMetadata(content)
    
    // 移除元数据，获取纯内容
    const cleanContent = this.stripMetadata(content)
    
    const result = {
      metadata,
      title: '',
      author: '',
      overallSummary: '',
      connections: '',
      chapters: [] as Array<{ title: string; summary: string }>
    }

    // 解析书名（一级标题）
    const titleMatch = cleanContent.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      result.title = titleMatch[1].trim()
    }

    // 解析作者
    const authorMatch = cleanContent.match(/\*\*作者\*\*:\s*(.+)$/m)
    if (authorMatch) {
      result.author = authorMatch[1].trim()
    }

    // 解析全书总结（## 全书总结 和下一个 ## 之间的内容）
    const overallSummaryMatch = cleanContent.match(/##\s+全书总结\n\n([\s\S]*?)(?=\n##|$)/)
    if (overallSummaryMatch) {
      result.overallSummary = overallSummaryMatch[1].trim()
    }

    // 解析章节关联分析
    const connectionsMatch = cleanContent.match(/##\s+章节关联分析\n\n([\s\S]*?)(?=\n##|$)/)
    if (connectionsMatch) {
      result.connections = connectionsMatch[1].trim()
    }

    // 解析章节摘要（从 ## 章节摘要 到文件末尾或下一个一级/二级标题）
    const chaptersSectionMatch = cleanContent.match(/##\s+章节摘要\n\n([\s\S]*$)/)
    if (chaptersSectionMatch) {
      const chaptersContent = chaptersSectionMatch[1]
      
      // 匹配各章节（### 标题）
      const chapterRegex = /###\s+(.+?)\n\n([\s\S]*?)(?=\n###|\n##|\n#|$)/g
      let match
      while ((match = chapterRegex.exec(chaptersContent)) !== null) {
        result.chapters.push({
          title: match[1].trim(),
          summary: match[2].trim()
        })
      }
    }

    return result
  }

  /**
   * 批量检查多个文件的缓存状态
   * @param fileNames 文件名列表
   * @param cachedFileNames 已缓存文件名集合（可选）
   * @returns 文件名到缓存状态的映射
   */
  async batchCheckCache(
    fileNames: string[],
    cachedFileNames?: Set<string>
  ): Promise<Map<string, boolean>> {
    const cachedFiles = cachedFileNames ?? await this.fetchCacheFileNames()
    const results = new Map<string, boolean>()

    fileNames.forEach((fileName) => {
      results.set(fileName, cachedFiles.has(this.getCacheFileName(fileName)))
    })

    return results
  }

  /**
   * 获取云端缓存文件名集合（{sanitizedName}-完整摘要.md）
   */
  async fetchCacheFileNames(): Promise<Set<string>> {
    const webdavConfig = useConfigStore.getState().webdavConfig
    const syncPath = webdavConfig.syncPath || '/fastReader'
    const result = await this.webdavService.getDirectoryContents(syncPath)

    if (!result.success || !result.data) {
      console.warn('[CloudCache] 获取缓存列表失败:', result.error)
      return new Set()
    }

    const cacheFiles = result.data
      .filter((file) => file.type === 'file')
      .map((file) => file.basename)
      .filter((name) => name.endsWith('-完整摘要.md'))

    return new Set(cacheFiles)
  }

}

// 导出单例
export const cloudCacheService = new CloudCacheService()
