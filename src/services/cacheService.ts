import type { MindElixirData } from 'mind-elixir'

// 定义缓存键类型
export type CacheKeyType =
  // 章节级缓存
  | 'summary'           // 章节总结
  | 'mindmap'          // 章节思维导图
  // 书籍级缓存
  | 'connections'      // 章节关联分析
  | 'overall_summary'  // 全书总结
  | 'combined_mindmap' // 整书思维导图（直接从整书内容生成）
  | 'merged_mindmap'   // 合并思维导图（从章节思维导图合并生成）
  | 'mindmap_arrows'   // 思维导图箭头
  | 'selected_chapters' // 选中的章节

// 定义缓存值的类型
export type CacheValue = string | MindElixirData | string[] | null

// 定义存储在 localStorage 中的缓存项结构
interface CacheItem {
  data: CacheValue
  timestamp: number
}

export class CacheService {
  private cache: Map<string, CacheValue>
  private readonly STORAGE_KEY = 'ebook-processor-cache'
  private readonly MAX_CACHE_SIZE = 100 // 最大缓存条目数
  private readonly CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7天

  constructor() {
    this.cache = new Map()
    this.loadFromLocalStorage()
  }

  // 从localStorage加载缓存
  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored) as Record<string, CacheItem>
        const now = Date.now()

        // 过滤过期的缓存项
        Object.entries(data).forEach(([key, value]: [string, CacheItem]) => {
          if (value.timestamp && (now - value.timestamp) < this.CACHE_EXPIRY) {
            this.cache.set(key, value.data)
          }
        })
      }
    } catch (error) {
      console.warn('加载缓存失败:', error)
      // 清除损坏的缓存
      localStorage.removeItem(this.STORAGE_KEY)
    }
  }

  // 保存缓存到localStorage
  private saveToLocalStorage(): void {
    try {
      const data: Record<string, CacheItem> = {}
      const now = Date.now()

      this.cache.forEach((value, key) => {
        data[key] = {
          data: value,
          timestamp: now
        }
      })

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.warn('保存缓存失败:', error)
    }
  }

  // 获取字符串类型的缓存值
  getString(filename: string, type: CacheKeyType, chapterId?: string): string | null {
    const key = CacheService.generateKey(filename, type, chapterId)
    const value = this.cache.get(key)
    return typeof value === 'string' ? value : null
  }

  // 获取思维导图类型的缓存值
  getMindMap(filename: string, type: CacheKeyType, chapterId?: string): MindElixirData | null {
    const key = CacheService.generateKey(filename, type, chapterId)
    const value = this.cache.get(key)
    return value && typeof value === 'object' && 'nodeData' in value ? value as MindElixirData : null
  }

  // 获取选中章节的缓存值
  getSelectedChapters(filename: string): string[] | null {
    const key = CacheService.generateKey(filename, 'selected_chapters')
    const value = this.cache.get(key)
    return Array.isArray(value) ? value : null
  }

  // 获取书籍总结缓存
  getSummary(filename: string): any | null {
    console.log('[DEBUG] CacheService.getSummary 开始:', {
      filename,
      timestamp: Date.now()
    })

    const stats = this.getStats()
    const cleanFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')

    console.log('[DEBUG] CacheService.getSummary cleanFilename:', {
      cleanFilename,
      cacheKeys: stats.keys
    })
    
    // 获取所有章节总结
    const chapterKeys = stats.keys.filter(key =>
      key.includes(`book_${cleanFilename}_chapter_`) &&
      key.endsWith('_summary')
    )
    
    const chapters = []
    for (const key of chapterKeys) {
      const value = this.cache.get(key)
      if (typeof value === 'string') {
        // 从key中提取chapterId
        const match = key.match(/_chapter_(.+)_summary$/)
        if (match) {
          const chapterId = match[1]
          chapters.push({
            id: chapterId,
            summary: value
          })
        }
      }
    }
    
    // 获取书籍级缓存
    const connections = this.getString(filename, 'connections')
    const overallSummary = this.getString(filename, 'overall_summary')
    
    if (chapters.length === 0 && !connections && !overallSummary) {
      return null
    }
    
    return {
      chapters,
      connections: connections || '',
      overallSummary: overallSummary || ''
    }
  }

  // 获取思维导图数据
  getMindMapData(filename: string): any | null {
    const stats = this.getStats()
    const cleanFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
    
    // 获取所有章节思维导图
    const chapterKeys = stats.keys.filter(key =>
      key.includes(`book_${cleanFilename}_chapter_`) &&
      key.endsWith('_mindmap')
    )
    
    const chapters = []
    for (const key of chapterKeys) {
      const value = this.cache.get(key)
      if (value && typeof value === 'object' && 'nodeData' in value) {
        // 从key中提取chapterId
        const match = key.match(/_chapter_(.+)_mindmap$/)
        if (match) {
          const chapterId = match[1]
          chapters.push({
            id: chapterId,
            mindMap: value
          })
        }
      }
    }
    
    // 获取整书思维导图
    const combinedMindMap = this.getMindMap(filename, 'combined_mindmap')
    
    if (chapters.length === 0 && !combinedMindMap) {
      return null
    }
    
    return {
      chapters,
      combinedMindMap
    }
  }

  // 获取通用缓存
  getCache(filename: string, type: CacheKeyType): any | null {
    if (type === 'summary') {
      return this.getSummary(filename)
    } else if (type === 'mindmap') {
      return this.getMindMapData(filename)
    } else {
      return this.getString(filename, type)
    }
  }

  // 设置缓存值（兼容测试的简化接口）
  set(filename: string, type: CacheKeyType, value: CacheValue, chapterId?: string): void {
    this.setCache(filename, type, value, chapterId)
  }

  // 设置缓存值
  setCache(filename: string, type: CacheKeyType, value: CacheValue, chapterId?: string): void {
    const key = CacheService.generateKey(filename, type, chapterId)

    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, value)
    this.saveToLocalStorage()
  }

  // 缓存选中的章节
  setSelectedChapters(filename: string, selectedChapters: Set<string>): void {
    const key = CacheService.generateKey(filename, 'selected_chapters')
    const value = Array.from(selectedChapters)
    
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, value)
    this.saveToLocalStorage()
  }

  // 删除缓存（公共接口，兼容测试）
  delete(filename: string, type: CacheKeyType, chapterId?: string): boolean {
    return this.deleteCache(filename, type, chapterId)
  }

  // 删除缓存
  private deleteCache(filename: string, type: CacheKeyType, chapterId?: string): boolean {
    const key = CacheService.generateKey(filename, type, chapterId)
    return this.deleteByKey(key)
  }

  // 通过键删除缓存
  private deleteByKey(key: string): boolean {
    const result = this.cache.delete(key)
    if (result) {
      this.saveToLocalStorage()
    }
    return result
  }

  // 获取缓存统计信息（用于清除整本书缓存时查找相关键）
  getStats(): { totalEntries: number; keys: string[] } {
    const keys = Array.from(this.cache.keys())
    return {
      totalEntries: keys.length,
      keys: keys
    }
  }

  // 统一的缓存键生成规则
  static generateKey(filename: string, type: CacheKeyType, chapterId?: string): string {
    // 清理文件名，移除扩展名和特殊字符
    const cleanFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')

    if (chapterId) {
      // 章节级缓存：book_filename_chapter_chapterId_type
      return `book_${cleanFilename}_chapter_${chapterId}_${type}`
    } else {
      // 书籍级缓存：book_filename_type
      return `book_${cleanFilename}_${type}`
    }
  }

  // 清除章节缓存
  clearChapterCache(fileName: string, chapterId: string, type: 'summary' | 'mindmap'): boolean {
    const cacheType: CacheKeyType = type
    return this.deleteCache(fileName, cacheType, chapterId)
  }

  // 清除特定类型缓存
  clearSpecificCache(fileName: string, cacheType: 'connections' | 'overall_summary' | 'combined_mindmap' | 'merged_mindmap' | 'selected_chapters'): boolean {
    const type: CacheKeyType = cacheType
    return this.deleteCache(fileName, type)
  }

  // 清除整本书缓存
  clearBookCache(fileName: string, processingMode?: 'summary' | 'mindmap' | 'combined_mindmap'): number {
    let deletedCount = 0

    // 清除选中章节缓存
    if (this.deleteCache(fileName, 'selected_chapters')) deletedCount++

    // 如果没有指定 processingMode，清除所有相关缓存
    if (!processingMode) {
      // 清除所有书籍级缓存
      if (this.deleteCache(fileName, 'summary')) deletedCount++
      if (this.deleteCache(fileName, 'connections')) deletedCount++
      if (this.deleteCache(fileName, 'overall_summary')) deletedCount++
      if (this.deleteCache(fileName, 'mindmap_arrows')) deletedCount++
      if (this.deleteCache(fileName, 'merged_mindmap')) deletedCount++
      if (this.deleteCache(fileName, 'combined_mindmap')) deletedCount++

      // 清除所有章节的缓存（任何类型）
      const stats = this.getStats()
      const cleanFilename = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
      const chapterKeys = stats.keys.filter(key =>
        key.includes(`book_${cleanFilename}_chapter_`)
      )
      chapterKeys.forEach(key => {
        if (this.deleteByKey(key)) deletedCount++
      })

      return deletedCount
    }

    if (processingMode === 'summary') {
      // 文字总结模式：清除章节总结、章节关联、全书总结相关缓存
      if (this.deleteCache(fileName, 'connections')) deletedCount++
      if (this.deleteCache(fileName, 'overall_summary')) deletedCount++

      // 清除所有章节的总结缓存
      const stats = this.getStats()
      const chapterKeys = stats.keys.filter(key =>
        key.includes(`book_${fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_chapter_`) &&
        key.endsWith('_summary')
      )
      chapterKeys.forEach(key => {
        if (this.deleteByKey(key)) deletedCount++
      })

    } else if (processingMode === 'mindmap') {
      // 章节思维导图模式：清除章节思维导图、思维导图箭头、合并思维导图相关缓存
      if (this.deleteCache(fileName, 'mindmap_arrows')) deletedCount++
      if (this.deleteCache(fileName, 'merged_mindmap')) deletedCount++

      // 清除所有章节的思维导图缓存
      const stats = this.getStats()
      const chapterKeys = stats.keys.filter(key =>
        key.includes(`book_${fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_chapter_`) &&
        key.endsWith('_mindmap')
      )
      chapterKeys.forEach(key => {
        if (this.deleteByKey(key)) deletedCount++
      })

    } else if (processingMode === 'combined_mindmap') {
      // 整书思维导图模式：清除整书思维导图相关缓存
      if (this.deleteCache(fileName, 'combined_mindmap')) deletedCount++
    }

    return deletedCount
  }
}