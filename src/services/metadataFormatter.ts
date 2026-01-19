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
  registerModelPricing
}
