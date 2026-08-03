import { webdavService } from './webdavService'
import { useConfigStore } from '../stores/configStore'
import { metadataFormatter } from './metadataFormatter'

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
 * 完整摘要：`{name}-完整摘要.md`
 * 关键图表：同名 JSON `{name}-完整摘要.json`（优先）；MD 内 ## 关键图表 为兜底
 */
export interface CacheReadResult {
  success: boolean
  content?: string
  /** 同名 .json 原文（若存在） */
  chartsJson?: string | null
  /** 是否发现图表文件（无论解析是否成功） */
  chartsFileFound?: boolean
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
  epubTocDepth?: number
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
   * 关键图表云存档：与完整摘要同名、扩展名为 .json
   * 例：`书名-完整摘要.md` → `书名-完整摘要.json`
   */
  getChartsCacheFileName(fileName: string): string {
    return this.getCacheFileName(fileName).replace(/\.md$/i, '.json')
  }

  getChartsCacheFilePath(fileName: string): string {
    const chartsName = this.getChartsCacheFileName(fileName)
    const webdavConfig = useConfigStore.getState().webdavConfig
    const syncPath = webdavConfig.syncPath || '/fastReader'
    return `${syncPath}/${chartsName}`
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
   * 读取关键图表同名 JSON（404 视为无文件，非失败）
   */
  async readChartsJson(fileName: string): Promise<{
    found: boolean
    content: string | null
    error?: string
  }> {
    try {
      const path = this.getChartsCacheFilePath(fileName)
      console.log(`[CloudCache] 读取图表 JSON: ${path}`)
      const result = await this.webdavService.getFileContents(path, 'text')
      if (!result.success || result.data == null) {
        const err = result.error || ''
        // 404 是正常「尚未生成」，不抬到 error
        if (err.includes('404') || err.includes('Not Found')) {
          console.log(`[CloudCache] 图表 JSON 不存在 (404): ${path}`)
        } else if (err) {
          console.warn(`[CloudCache] 读取图表 JSON 失败: ${path}`, err)
        }
        return { found: false, content: null, error: result.error }
      }
      const text = String(result.data)
      console.log(`[CloudCache] 图表 JSON 已读取: ${path}, ${text.length} chars`)
      return { found: true, content: text }
    } catch (error) {
      console.warn('[CloudCache] 读取图表 JSON 失败:', error)
      return {
        found: false,
        content: null,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  /**
   * 上传关键图表 JSON（与完整摘要同名）
   */
  async uploadChartsJson(
    fileName: string,
    charts: unknown
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      if (charts == null) {
        return { success: false, error: '无图表数据' }
      }
      if (!this.webdavService.isInitialized()) {
        const webdavConfig = useConfigStore.getState().webdavConfig
        if (!webdavConfig.enabled) {
          return { success: false, error: 'WebDAV 未启用' }
        }
        const init = await this.webdavService.initialize(webdavConfig)
        if (!init.success) {
          return { success: false, error: init.error || 'WebDAV 未初始化' }
        }
      }
      const path = this.getChartsCacheFilePath(fileName)
      const body = JSON.stringify(charts, null, 2)
      console.log(`[CloudCache] 上传图表 JSON: ${path} (${body.length} chars)`)
      const upload = await this.webdavService.uploadFile(path, body)
      if (!upload.success) {
        console.warn(`[CloudCache] 图表 JSON 上传失败: ${path}`, upload.error)
        return { success: false, error: upload.error || '上传图表 JSON 失败' }
      }
      // 回读校验：优先 GET；失败则用 exists 兜底（部分网盘写后瞬间 GET 不稳）
      const verify = await this.webdavService.getFileContents(path, 'text')
      if (verify.success && verify.data != null) {
        console.log(
          `[CloudCache] 图表 JSON 已上传并校验: ${path}, ${String(verify.data).length} chars`
        )
        return { success: true, path }
      }
      const exists = await this.webdavService.fileExists(path)
      if (exists) {
        console.log(`[CloudCache] 图表 JSON 已上传 (exists 校验): ${path}`)
        return { success: true, path }
      }
      console.warn(
        `[CloudCache] 图表 JSON 上传后校验失败: ${path}`,
        verify.error
      )
      return {
        success: false,
        error: verify.error || '上传后校验失败（可能未真正写入）',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  /**
   * 读取缓存文件内容（MD + 并行尝试同名 JSON）
   * @param fileName 原始文件名
   * @returns 缓存读取结果
   */
  async readCache(fileName: string): Promise<CacheReadResult> {
    try {
      const cachePath = this.getCacheFilePath(fileName)
      console.log(`[CloudCache] 读取缓存: ${cachePath}`)

      // 串行：先 MD 后 JSON（WebDAV 代理用共享 header 传路径，并发会竞态）
      const downloadResult = await this.webdavService.getFileContents(cachePath, 'text')
      const chartsResult = await this.readChartsJson(fileName)

      console.log(
        `[CloudCache] 图表 JSON: found=${chartsResult.found}, len=${chartsResult.content?.length ?? 0}` +
          (chartsResult.error ? `, err=${chartsResult.error}` : '')
      )

      if (!downloadResult.success || !downloadResult.data) {
        return {
          success: false,
          error: downloadResult.error || '下载缓存文件失败',
          chartsJson: chartsResult.content,
          chartsFileFound: chartsResult.found,
        }
      }

      const content = downloadResult.data as string
      const metadata = this.parseMetadata(content)

      return {
        success: true,
        content,
        metadata: metadata || undefined,
        chartsJson: chartsResult.content,
        chartsFileFound: chartsResult.found,
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
          case 'epubTocDepth':
            metadata.epubTocDepth = value === 'N/A' ? undefined : parseInt(value, 10) || undefined
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
    charts: Record<string, unknown> | null
  } {
    // 与 metadataFormatter 统一解析，避免两套规则漂移
    const { metadata, data } = metadataFormatter.parseUnified(content)
    return {
      metadata,
      title: data.title || '',
      author: data.author || '',
      overallSummary: data.overallSummary || '',
      connections: data.connections || '',
      chapters: data.chapters.map((ch) => ({
        title: ch.title,
        summary: ch.summary,
      })),
      charts: (data.charts as Record<string, unknown> | null) || null,
    }
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
