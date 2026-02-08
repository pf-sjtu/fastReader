import { WebDAVService } from './webdavService'
import { useConfigStore } from '../stores/configStore'
import { metadataFormatter, type ProcessResultInfo } from './metadataFormatter'

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
   * 同步摘要文件到WebDAV
   * 生成与手动上传一致的单个完整 Markdown 文件
   */
  async syncSummary(bookSummary: BookSummary, fileName: string, chapterNamingMode: 'auto' | 'numbered' = 'auto'): Promise<boolean> {
    try {
      // 检查是否启用自动同步
      const webdavConfig = useConfigStore.getState().webdavConfig
      const processingOptions = useConfigStore.getState().processingOptions

      if (!webdavConfig.enabled || !webdavConfig.autoSync) {
        return false
      }

      // 初始化WebDAV服务
      const initResult = await this.webdavService.initialize(webdavConfig)
      if (!initResult.success) {
        console.error('WebDAV初始化失败:', initResult.error)
        return false
      }

      // 检查连接
      const connectionTest = await this.webdavService.testConnection()
      if (!connectionTest.success) {
        console.error('WebDAV连接失败:', connectionTest.error)
        return false
      }

      // 生成统一的完整摘要文件（与手动上传格式一致）
      const summaryContent = this.formatUnifiedSummary(bookSummary, fileName, chapterNamingMode, processingOptions)

      // 清理文件名
      const sanitizedName = fileName
        .replace(/\.[^/.]+$/, '')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const remoteFileName = `${sanitizedName}-完整摘要.md`
      const remotePath = `${webdavConfig.syncPath}/${remoteFileName}`

      // 上传文件
      const uploadResult = await this.webdavService.uploadFile(remotePath, summaryContent)

      if (uploadResult.success) {
        console.log(`✅ 摘要文件同步成功: ${remoteFileName}`)
        // 更新最后同步时间
        useConfigStore.getState().updateWebDAVLastSyncTime()
        return true
      } else {
        console.error('摘要文件同步失败:', uploadResult.error)
        return false
      }
    } catch (error) {
      console.error('同步摘要文件时发生错误:', error)
      return false
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
      connections: bookSummary.connections
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
