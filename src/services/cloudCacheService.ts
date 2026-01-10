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
    const sanitizedName = this.sanitizeFileName(fileName)
    const webdavConfig = useConfigStore.getState().webdavConfig
    const syncPath = webdavConfig.syncPath || '/fastReader'

    return `${syncPath}/${sanitizedName}-完整摘要.md`
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
   * 读取缓存文件内容
   * @param fileName 原始文件名
   * @returns 缓存读取结果
   */
  async readCache(fileName: string): Promise<CacheReadResult> {
    try {
      const cachePath = this.getCacheFilePath(fileName)
      console.log(`[CloudCache] 读取缓存: ${cachePath}`)

      // 下载文件
      const downloadResult = await this.webdavService.downloadFileAsText(cachePath)

      if (!downloadResult.success || !downloadResult.data) {
        return {
          success: false,
          error: downloadResult.error || '下载缓存文件失败'
        }
      }

      // 解析元数据
      const metadata = this.parseMetadata(downloadResult.data)

      return {
        success: true,
        content: downloadResult.data,
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
        costRMB: 0
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
   * 批量检查多个文件的缓存状态
   * @param fileNames 文件名列表
   * @returns 文件名到缓存状态的映射
   */
  async batchCheckCache(fileNames: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()

    // 批量检查，但限制并发数
    const batchSize = 5
    for (let i = 0; i < fileNames.length; i += batchSize) {
      const batch = fileNames.slice(i, i + batchSize)
      const promises = batch.map(async (fileName) => {
        const exists = await this.checkCacheExists(fileName)
        results.set(fileName, exists)
      })
      await Promise.all(promises)
    }

    return results
  }
}

// 导出单例
export const cloudCacheService = new CloudCacheService()
