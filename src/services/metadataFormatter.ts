/**
 * 处理元数据格式化器
 * 用于生成和解析处理结果文件头部的 HTML 格式备注
 */

import type { ProcessingMetadata } from './cloudCacheService'

// 默认汇率（USD -> CNY）
const DEFAULT_EXCHANGE_RATE = 7.0

// AI 模型定价（每百万 Token 美元）
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini models
  'gemini-1.5-pro': { input: 1.25, output: 18.75 },
  'gemini-1.5-flash': { input: 0.075, output: 1.125 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  // OpenAI models
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  // Ollama (本地模型，通常免费)
  'llama3': { input: 0, output: 0 },
  'llama3.1': { input: 0, output: 0 },
  'qwen2': { input: 0, output: 0 },
  // 302.ai (使用 OpenAI 兼容定价)
  'openai/gpt-4o': { input: 5.0, output: 15.0 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}

/**
 * AI API 响应信息
 */
export interface AIResponseInfo {
  inputTokens: number
  outputTokens: number
}

/**
 * 处理结果信息
 */
export interface ProcessResultInfo {
  fileName: string
  bookTitle?: string
  model: string
  chapterDetectionMode: string
  epubTocDepth?: number
  selectedChapters: number[]
  selectedChapterCount?: number
  chapterCount: number
  originalCharCount: number
  processedCharCount: number
  skippedChapters?: number
  isPartial?: boolean
  aiResponseInfo?: AIResponseInfo
}


/**
 * 获取汇率
 * 从环境变量读取，默认 7.0
 */
function getExchangeRate(): number {
  if (typeof window !== 'undefined') {
    // 浏览器环境
    return DEFAULT_EXCHANGE_RATE
  }

  // Node.js 环境
  const envRate = process.env.EXCHANGE_RATE_USD_TO_CNY
  if (envRate) {
    return parseFloat(envRate) || DEFAULT_EXCHANGE_RATE
  }

  return DEFAULT_EXCHANGE_RATE
}

/**
 * 计算处理费用
 * @param model 模型名称
 * @param inputTokens 输入 Token 数
 * @param outputTokens 输出 Token 数
 * @returns 费用信息 { costUSD, costRMB }
 */
function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { costUSD: number; costRMB: number } {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-1.5-pro']
  const exchangeRate = getExchangeRate()

  // 计算美元费用（每百万 Token 定价 / 1,000,000 * Token 数）
  const inputCost = (pricing.input / 1_000_000) * inputTokens
  const outputCost = (pricing.output / 1_000_000) * outputTokens
  const costUSD = inputCost + outputCost

  // 转换为人民币
  const costRMB = costUSD * exchangeRate

  return {
    costUSD: Math.round(costUSD * 100000) / 100000, // 保留 5 位小数
    costRMB: Math.round(costRMB * 100000) / 100000
  }
}

/**
 * 生成处理元数据
 * @param result 处理结果信息
 * @returns 处理元数据对象
 */
export function generateMetadata(result: ProcessResultInfo): ProcessingMetadata {
  const {
    fileName,
    model,
    chapterDetectionMode,
    epubTocDepth,
    selectedChapters,
    selectedChapterCount,
    chapterCount,
    originalCharCount,
    processedCharCount,
    skippedChapters,
    isPartial,
    aiResponseInfo
  } = result


  // 获取 Token 数
  const inputTokens = aiResponseInfo?.inputTokens || 0
  const outputTokens = aiResponseInfo?.outputTokens || 0

  // 计算费用
  const { costUSD, costRMB } = calculateCost(model, inputTokens, outputTokens)

  const metadata: ProcessingMetadata = {
    source: 'WebDAV',
    fileName: fileName,
    processedAt: new Date().toISOString(),
    model: model,
    chapterDetectionMode: chapterDetectionMode,
    epubTocDepth: epubTocDepth,
    selectedChapters: selectedChapters.join(','),
    selectedChapterCount: selectedChapterCount ?? selectedChapters.length,
    chapterCount: chapterCount,
    originalCharCount: originalCharCount,
    processedCharCount: processedCharCount,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    costUSD: costUSD,
    costRMB: costRMB
  }


  if (typeof skippedChapters === 'number') {
    ;(metadata as ProcessingMetadata & { skippedChapters: number }).skippedChapters = skippedChapters
  }

  if (typeof selectedChapterCount === 'number') {
    ;(metadata as ProcessingMetadata & { selectedChapterCount: number }).selectedChapterCount = selectedChapterCount
  }

  if (typeof isPartial === 'boolean') {
    ;(metadata as ProcessingMetadata & { isPartial: boolean }).isPartial = isPartial
  }


  return metadata
}

/**
 * 将元数据格式化为 HTML 注释
 * @param metadata 处理元数据
 * @returns HTML 注释格式的字符串
 */
export function formatAsHTMLComment(metadata: ProcessingMetadata): string {
  const lines = [
    `source: ${metadata.source}`,
    `fileName: ${metadata.fileName}`,
    `processedAt: ${metadata.processedAt}`,
    `model: ${metadata.model}`,
    `chapterDetectionMode: ${metadata.chapterDetectionMode}`,
    `epubTocDepth: ${metadata.epubTocDepth ?? 'N/A'}`,
    `selectedChapters: ${metadata.selectedChapters}`,
    `selectedChapterCount: ${
      typeof (metadata as ProcessingMetadata & { selectedChapterCount?: number }).selectedChapterCount === 'number'
        ? (metadata as ProcessingMetadata & { selectedChapterCount: number }).selectedChapterCount
        : metadata.selectedChapters.split(',').filter(Boolean).length
    }`,
    `chapterCount: ${metadata.chapterCount}`,
    `originalCharCount: ${metadata.originalCharCount}`,
    `processedCharCount: ${metadata.processedCharCount}`,
    `inputTokens: ${metadata.inputTokens}`,
    `outputTokens: ${metadata.outputTokens}`,
    `costUSD: ${metadata.costUSD}`,
    `costRMB: ${metadata.costRMB} (USD/CNY: ${getExchangeRate()})`
  ]

  if (typeof (metadata as ProcessingMetadata & { skippedChapters?: number }).skippedChapters === 'number') {
    lines.push(`skippedChapters: ${(metadata as ProcessingMetadata & { skippedChapters: number }).skippedChapters}`)
  }

  if (typeof (metadata as ProcessingMetadata & { isPartial?: boolean }).isPartial === 'boolean') {
    lines.push(`isPartial: ${(metadata as ProcessingMetadata & { isPartial: boolean }).isPartial}`)
  }


  return `<!--\n${lines.join('\n')}\n-->`
}

/**
 * 将元数据添加到文件内容头部
 * @param content 原始文件内容
 * @param metadata 处理元数据
 * @returns 添加备注后的文件内容
 */
export function addMetadataToContent(content: string, metadata: ProcessingMetadata): string {
  const comment = formatAsHTMLComment(metadata)
  return `${comment}\n\n${content}`
}

/**
 * 从文件内容中解析元数据
 * @param content 文件内容
 * @returns 解析出的元数据或 null
 */
export function parseMetadataFromContent(content: string): ProcessingMetadata | null {
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
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()

      switch (key) {
        case 'source':
          metadata.source = value
          break
        case 'fileName':
          metadata.fileName = value
          break
        case 'processedAt':
          metadata.processedAt = value
          break
        case 'model':
          metadata.model = value
          break
        case 'chapterDetectionMode':
          metadata.chapterDetectionMode = value
          break
        case 'epubTocDepth':
          metadata.epubTocDepth = value === 'N/A' ? undefined : parseInt(value, 10) || undefined
          break
        case 'selectedChapters':
          metadata.selectedChapters = value
          break
        case 'chapterCount':
          metadata.chapterCount = parseInt(value, 10) || 0
          break
        case 'originalCharCount':
          metadata.originalCharCount = parseInt(value, 10) || 0
          break
        case 'processedCharCount':
          metadata.processedCharCount = parseInt(value, 10) || 0
          break
        case 'inputTokens':
          metadata.inputTokens = parseInt(value, 10) || 0
          break
        case 'outputTokens':
          metadata.outputTokens = parseInt(value, 10) || 0
          break
        case 'costUSD':
          metadata.costUSD = parseFloat(value) || 0
          break
        case 'costRMB':
          metadata.costRMB = parseFloat(value) || 0
          break
        case 'skippedChapters':
          ;(metadata as ProcessingMetadata & { skippedChapters: number }).skippedChapters = parseInt(value, 10) || 0
          break
        case 'selectedChapterCount':
          ;(metadata as ProcessingMetadata & { selectedChapterCount: number }).selectedChapterCount = parseInt(value, 10) || 0
          break
        case 'isPartial':
          ;(metadata as ProcessingMetadata & { isPartial: boolean }).isPartial = value === 'true'
          break
      }
    }


    return metadata
  } catch (error) {
    console.error('[MetadataFormatter] 解析元数据失败:', error)
    return null
  }
}

/**
 * 从文件内容中移除元数据备注
 * @param content 包含备注的文件内容
 * @returns 纯 Markdown 内容
 */
export function stripMetadataFromContent(content: string): string {
  return content.replace(/<!--\s*\n[\s\S]*?\n-->\n*/, '')
}

// ============================================================================
// 统一的 Markdown 格式化函数
// ============================================================================

/**
 * 章节数据接口
 */
export interface ChapterSummaryData {
  id: string
  title: string
  summary: string
}

/**
 * 统一格式的书籍摘要数据
 */
export interface UnifiedBookSummaryData {
  title: string
  author?: string
  chapters: ChapterSummaryData[]
  overallSummary?: string
  connections?: string
}

/**
 * 生成统一格式的 Markdown 内容
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
 * @param data 书籍摘要数据
 * @param metadata 处理元数据（可选）
 * @param chapterNamingMode 章节命名模式
 * @returns 统一格式的 Markdown 内容
 */
export function formatUnifiedMarkdown(
  data: UnifiedBookSummaryData,
  metadata?: ProcessingMetadata,
  chapterNamingMode: 'auto' | 'numbered' = 'auto'
): string {
  const lines: string[] = []

  // 1. 头部元数据（HTML 注释格式）
  if (metadata) {
    lines.push(formatAsHTMLComment(metadata))
    lines.push('')
  }

  // 2. 书名 - 一级标题
  lines.push(`# ${data.title}`)
  lines.push('')

  // 3. 作者信息
  if (data.author) {
    lines.push(`**作者**: ${data.author}`)
    lines.push('')
  }

  // 4. 全书总结 - 二级标题
  if (data.overallSummary) {
    lines.push('## 全书总结')
    lines.push('')
    lines.push(data.overallSummary)
    lines.push('')
  }

  // 5. 章节关联分析 - 二级标题
  if (data.connections) {
    lines.push('## 章节关联分析')
    lines.push('')
    lines.push(data.connections)
    lines.push('')
  }

  // 6. 章节摘要 - 二级标题
  if (data.chapters.length > 0) {
    lines.push('## 章节摘要')
    lines.push('')

    // 7. 各章节 - 三级标题
    data.chapters.forEach((chapter, index) => {
      // 根据章节命名模式生成标题
      let chapterTitle: string
      if (chapterNamingMode === 'numbered') {
        chapterTitle = `第${String(index + 1).padStart(2, '0')}章`
      } else {
        chapterTitle = chapter.title || `第${index + 1}章`
      }

      lines.push(`### ${chapterTitle}`)
      lines.push('')
      lines.push(chapter.summary || '（暂无总结）')
      lines.push('')
    })
  }

  return lines.join('\n')
}

/**
 * 解析统一格式的 Markdown 内容
 *
 * @param content Markdown 内容
 * @returns 解析后的数据对象
 */
export function parseUnifiedMarkdown(content: string): {
  metadata: ProcessingMetadata | null
  data: UnifiedBookSummaryData
} {
  // 解析元数据
  const metadata = parseMetadataFromContent(content)
  
  // 移除元数据，获取纯内容
  const cleanContent = stripMetadataFromContent(content)
  
  const data: UnifiedBookSummaryData = {
    title: '',
    author: '',
    chapters: []
  }

  // 解析书名（一级标题）
  const titleMatch = cleanContent.match(/^#\s+(.+)$/m)
  if (titleMatch) {
    data.title = titleMatch[1].trim()
  }

  // 解析作者
  const authorMatch = cleanContent.match(/\*\*作者\*\*:\s*(.+)$/m)
  if (authorMatch) {
    data.author = authorMatch[1].trim()
  }

  // 解析全书总结（## 全书总结 和下一个 ## 之间的内容）
  const overallSummaryMatch = cleanContent.match(/##\s+全书总结\n\n([\s\S]*?)(?=\n##|$)/)
  if (overallSummaryMatch) {
    data.overallSummary = overallSummaryMatch[1].trim()
  }

  // 解析章节关联分析
  const connectionsMatch = cleanContent.match(/##\s+章节关联分析\n\n([\s\S]*?)(?=\n##|$)/)
  if (connectionsMatch) {
    data.connections = connectionsMatch[1].trim()
  }

  // 解析章节摘要（从 ## 章节摘要 到文件末尾或下一个一级/二级标题）
  const chaptersSectionMatch = cleanContent.match(/##\s+章节摘要\n\n([\s\S]*$)/)
  if (chaptersSectionMatch) {
    const chaptersContent = chaptersSectionMatch[1]
    
    // 匹配各章节（### 标题）
    const chapterRegex = /###\s+(.+?)\n\n([\s\S]*?)(?=\n###|\n##|\n#|$)/g
    let match
    while ((match = chapterRegex.exec(chaptersContent)) !== null) {
      data.chapters.push({
        id: `chapter-${data.chapters.length + 1}`,
        title: match[1].trim(),
        summary: match[2].trim()
      })
    }
  }

  return { metadata, data }
}

/**
 * 获取模型定价信息
 * @param model 模型名称
 * @returns 定价信息或 null
 */
export function getModelPricing(model: string): { input: number; output: number } | null {
  return MODEL_PRICING[model] || null
}

/**
 * 添加自定义模型定价
 * @param model 模型名称
 * @param inputPrice 输入价格（每百万 Token 美元）
 * @param outputPrice 输出价格（每百万 Token 美元）
 */
export function registerModelPricing(
  model: string,
  inputPrice: number,
  outputPrice: number
): void {
  MODEL_PRICING[model] = { input: inputPrice, output: outputPrice }
}

// 导出单例工厂函数
export const metadataFormatter = {
  generate: generateMetadata,
  formatAsComment: formatAsHTMLComment,
  addToContent: addMetadataToContent,
  parse: parseMetadataFromContent,
  strip: stripMetadataFromContent,
  getModelPricing,
  registerModelPricing,
  // 统一的 Markdown 格式化函数
  formatUnified: formatUnifiedMarkdown,
  parseUnified: parseUnifiedMarkdown
}
