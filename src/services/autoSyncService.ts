import { WebDAVService } from './webdavService'
import { useConfigStore } from '../stores/configStore'
import { metadataFormatter, type ProcessResultInfo } from './metadataFormatter'
import { cloudCacheService } from './cloudCacheService'

// 定义本地类型（避免循环依赖）
interface BookSummary {
  title: string
  author: string
  chapters: Array<{
    id: string
    title: string
    content: string
    summary?: string
    processed: boolean
  }>
  connections: string
  overallSummary: string
  charts?: unknown
}

interface BookMindMap {
  title: string
  author: string
  chapters: Array<{
    id: string
    title: string
    content: string
    mindMap?: unknown
    processed: boolean
  }>
  combinedMindMap?: unknown
}

// 同步文件类型
export type SyncFileType = 'summary' | 'mindmap' | 'combined_mindmap'

// 同步文件信息
export interface SyncFileInfo {
  name: string
  content: string | ArrayBuffer
  path: string
  type: SyncFileType
}

/**
 * 自动同步服务
 * 负责在文件处理完成后自动同步到WebDAV
 */
export class AutoSyncService {
  private webdavService: WebDAVService

  constructor() {
    this.webdavService = new WebDAVService()
  }

  /**
   * 同步摘要文件到 WebDAV
   * - MD：`{name}-完整摘要.md`
   * - 关键图表（若有）：同名 JSON `{name}-完整摘要.json`
   * @param options.force 为 true 时忽略 autoSync 开关（手动重生成图表后回写）
   */
  async syncSummary(
    bookSummary: BookSummary,
    fileName: string,
    chapterNamingMode: 'auto' | 'numbered' = 'auto',
    options?: { force?: boolean }
  ): Promise<boolean> {
    try {
      const webdavConfig = useConfigStore.getState().webdavConfig
      const processingOptions = useConfigStore.getState().processingOptions
      const force = options?.force === true

      if (!webdavConfig.enabled) {
        return false
      }
      if (!force && !webdavConfig.autoSync) {
        return false
      }

      const initResult = await this.webdavService.initialize(webdavConfig)
      if (!initResult.success) {
        console.error('WebDAV初始化失败:', initResult.error)
        return false
      }

      const connectionTest = await this.webdavService.testConnection()
      if (!connectionTest.success) {
        console.error('WebDAV连接失败:', connectionTest.error)
        return false
      }

      const summaryContent = this.formatUnifiedSummary(
        bookSummary,
        fileName,
        chapterNamingMode,
        processingOptions
      )

      // 用 cloudCache 统一路径规则（与读取一致）
      const mdPath = cloudCacheService.getCacheFilePath(fileName)
      const uploadResult = await this.webdavService.uploadFile(mdPath, summaryContent)

      if (!uploadResult.success) {
        console.error('摘要文件同步失败:', uploadResult.error)
        return false
      }

      console.log(`✅ 摘要 MD 同步成功: ${mdPath}`)

      // 有图表则写同名 JSON；无图表不删旧文件（避免误清）
      if (bookSummary.charts) {
        const chartsUp = await cloudCacheService.uploadChartsJson(
          fileName,
          bookSummary.charts
        )
        if (chartsUp.success) {
          console.log(`✅ 关键图表 JSON 同步成功: ${chartsUp.path}`)
        } else {
          console.warn('关键图表 JSON 同步失败:', chartsUp.error)
          // MD 已成功；图表失败单独告警，整体仍返回 true 但由调用方可查
        }
      }

      useConfigStore.getState().updateWebDAVLastSyncTime()
      return true
    } catch (error) {
      console.error('同步摘要文件时发生错误:', error)
      return false
    }
  }

  /**
   * 仅上传关键图表同名 JSON（不依赖 autoSync）
   * 用于：整本处理生成图表后、或 MD 同步关闭时仍要落盘图表
   */
  async syncChartsJson(
    fileName: string,
    charts: unknown
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const webdavConfig = useConfigStore.getState().webdavConfig
      if (!webdavConfig.enabled) {
        return { success: false, error: 'WebDAV 未启用' }
      }
      if (charts == null) {
        return { success: false, error: '无图表数据' }
      }

      const initResult = await this.webdavService.initialize(webdavConfig)
      if (!initResult.success) {
        return { success: false, error: initResult.error || 'WebDAV 初始化失败' }
      }

      const connectionTest = await this.webdavService.testConnection()
      if (!connectionTest.success) {
        return { success: false, error: connectionTest.error || 'WebDAV 连接失败' }
      }

      const up = await cloudCacheService.uploadChartsJson(fileName, charts)
      if (up.success) {
        console.log(`✅ 关键图表 JSON 已保存: ${up.path}`)
        useConfigStore.getState().updateWebDAVLastSyncTime()
      }
      return up
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  /**
   * 同步思维导图文件到WebDAV
   */
  async syncMindMap(bookMindMap: BookMindMap, fileName: string): Promise<boolean> {
    try {
      // 检查是否启用自动同步
      const config = useConfigStore.getState().webdavConfig
      if (!config.enabled || !config.autoSync) {
        console.log('自动同步未启用，跳过同步')
        return true
      }

      // 初始化WebDAV服务
      const initResult = await this.webdavService.initialize(config)
      if (!initResult.success) {
        console.error('WebDAV初始化失败:', initResult.error)
        return false
      }

      // 准备同步文件
      const syncFiles: SyncFileInfo[] = []

      // 添加各章节思维导图
      bookMindMap.chapters.forEach((chapter, index) => {
        if (chapter.mindMap) {
          const mindMapJson = JSON.stringify(chapter.mindMap, null, 2)
          syncFiles.push({
            name: `${fileName}_chapter_${index + 1}_mindmap.json`,
            content: mindMapJson,
            path: `${fileName}/mindmaps/${fileName}_chapter_${index + 1}_mindmap.json`,
            type: 'mindmap'
          })
        }
      })

      // 添加整书思维导图（如果存在）
      if (bookMindMap.combinedMindMap) {
        const combinedMindMapJson = JSON.stringify(bookMindMap.combinedMindMap, null, 2)
        syncFiles.push({
          name: `${fileName}_combined_mindmap.json`,
          content: combinedMindMapJson,
          path: `${fileName}/${fileName}_combined_mindmap.json`,
          type: 'combined_mindmap'
        })
      }

      // 执行同步
      const syncResult = await this.webdavService.syncFiles(syncFiles)
      
      if (syncResult.success) {
        console.log(`✅ 思维导图文件同步成功: ${syncFiles.length} 个文件`)
        // 更新最后同步时间
        useConfigStore.getState().updateWebDAVLastSyncTime()
        return true
      } else {
        console.error('思维导图文件同步失败:', syncResult.error)
        return false
      }
    } catch (error) {
      console.error('同步思维导图文件时发生错误:', error)
      return false
    }
  }

  /**
   * 格式化统一摘要为Markdown（与手动上传格式一致）
   * @param bookSummary 书籍摘要数据
   * @param fileName 原始文件名
   * @param chapterNamingMode 章节命名模式
   * @param processingOptions 处理选项（包含 chapterDetectionMode 和 epubTocDepth）
   */
  private formatUnifiedSummary(
    bookSummary: BookSummary,
    fileName: string,
    chapterNamingMode: 'auto' | 'numbered' = 'auto',
    processingOptions?: { chapterDetectionMode?: string; epubTocDepth?: number }
  ): string {
    // 准备章节数据
    const chapters = bookSummary.chapters.map(chapter => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || ''
    }))

    // 准备书籍数据
    const bookData = {
      title: bookSummary.title,
      author: bookSummary.author,
      chapters: chapters,
      overallSummary: bookSummary.overallSummary,
      connections: bookSummary.connections,
      charts: bookSummary.charts
        ? (bookSummary.charts as unknown as Record<string, unknown>)
        : null,
    }

    // 计算原始内容字符数
    const originalCharCount = bookSummary.chapters.reduce(
      (total, ch) => total + (ch.content?.length || 0),
      0
    )

    // 计算处理后内容字符数
    const processedCharCount = bookSummary.chapters.reduce(
      (total, ch) => total + (ch.summary?.length || 0),
      0
    )

    // 选中的章节（有 summary 的章节）
    const selectedChapters = bookSummary.chapters
      .map((_, index) => index + 1)
      .filter((_, idx) => bookSummary.chapters[idx]?.summary)

    // 获取 AI 配置用于元数据
    const aiConfig = useConfigStore.getState().aiConfig

    // 生成元数据（包含目录识别方式和层级信息）
    const metadataInput: ProcessResultInfo = {
      fileName: fileName,
      bookTitle: bookSummary.title,
      model: aiConfig.model || 'unknown',
      chapterDetectionMode: processingOptions?.chapterDetectionMode || 'normal',
      epubTocDepth: processingOptions?.epubTocDepth,
      selectedChapters: selectedChapters,
      chapterCount: bookSummary.chapters.length,
      originalCharCount: originalCharCount,
      processedCharCount: processedCharCount
    }

    const metadata = metadataFormatter.generate(metadataInput)

    // 使用统一格式生成 Markdown（与手动上传完全一致）
    return metadataFormatter.formatUnified(bookData, metadata, chapterNamingMode)
  }

  /**
   * 格式化章节摘要
   */
  private formatChapterSummary(chapter: { title?: string; summary?: string }, chapterNumber: number, chapterNamingMode: 'auto' | 'numbered' = 'auto'): string {
    // 根据章节命名模式生成标题
    let chapterTitle: string
    if (chapterNamingMode === 'numbered') {
      chapterTitle = `第${String(chapterNumber).padStart(2, '0')}章`
    } else {
      chapterTitle = chapter.title || `第${chapterNumber}章`
    }

    let markdown = `# ${chapterTitle}\n\n`
    markdown += `${chapter.summary}\n\n`
    markdown += `---\n*由 fastReader 自动生成于 ${new Date().toLocaleString('zh-CN')}*`

    return markdown
  }
}

// 导出单例实例
export const autoSyncService = new AutoSyncService()
