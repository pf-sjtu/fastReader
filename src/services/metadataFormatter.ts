/**
 * 处理元数据格式化器
 * 用于生成和解析处理结果文件头部的 HTML 格式备注
 */

import type { ProcessingMetadata } from './cloudCacheService'
import { isFailedText, isPlaceholderText } from '../utils/resultStatus'

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


// 汇率与价格来自共享配置（由 App 启动时注入，避免 services ←→ stores 循环依赖）
let exchangeRateProvider: () => number = () => DEFAULT_EXCHANGE_RATE
let pricingProvider: (model: string) => { input: number; output: number } | null = () => null

/** 注入汇率来源（共享处理配置里的 exchangeRateUsdToCny） */
export function setExchangeRateProvider(provider: () => number): void {
  exchangeRateProvider = provider
}

/** 注入模型价格来源（models.dev 元数据优先） */
export function setPricingProvider(provider: (model: string) => { input: number; output: number } | null): void {
  pricingProvider = provider
}

/**
 * 获取汇率：共享配置 > 默认 7.0
 */
function getExchangeRate(): number {
  try {
    const rate = exchangeRateProvider()
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) return rate
  } catch {
    // ignore：取不到就用默认值
  }
  return DEFAULT_EXCHANGE_RATE
}

/**
 * 查模型价格：models.dev 元数据 → 内置表 → 未知
 *
 * 未知时返回 null（不再拿别的模型顶替，否则费用显示会系统性失真）。
 */
function resolvePricing(model: string): { input: number; output: number } | null {
  try {
    const fromCatalog = pricingProvider(model)
    if (fromCatalog) return fromCatalog
  } catch {
    // ignore
  }
  return MODEL_PRICING[model] ?? null
}

/**
 * 计算处理费用
 * @param model 模型名称
 * @param inputTokens 输入 Token 数
 * @param outputTokens 输出 Token 数
 * @returns 费用信息 { costUSD, costRMB }
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { costUSD: number; costRMB: number; pricingKnown: boolean } {
  const pricing = resolvePricing(model)
  if (!pricing) {
    return { costUSD: 0, costRMB: 0, pricingKnown: false }
  }

  const exchangeRate = getExchangeRate()

  // 计算美元费用（每百万 Token 定价 / 1,000,000 * Token 数）
  const inputCost = (pricing.input / 1_000_000) * inputTokens
  const outputCost = (pricing.output / 1_000_000) * outputTokens
  const costUSD = inputCost + outputCost

  // 转换为人民币
  const costRMB = costUSD * exchangeRate

  return {
    costUSD: Math.round(costUSD * 100000) / 100000, // 保留 5 位小数
    costRMB: Math.round(costRMB * 100000) / 100000,
    pricingKnown: true
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
  const { costUSD, costRMB, pricingKnown } = calculateCost(model, inputTokens, outputTokens)

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
    costUSD: pricingKnown ? costUSD : undefined,
    costRMB: pricingKnown ? costRMB : undefined,
    pricingKnown
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
    `costUSD: ${metadata.costUSD ?? 'N/A'}`,
    `costRMB: ${metadata.costRMB ?? 'N/A'} (USD/CNY: ${getExchangeRate()})`
  ]

  if (typeof (metadata as ProcessingMetadata & { skippedChapters?: number }).skippedChapters === 'number') {
    lines.push(`skippedChapters: ${(metadata as ProcessingMetadata & { skippedChapters: number }).skippedChapters}`)
  }

  if (typeof (metadata as ProcessingMetadata & { isPartial?: boolean }).isPartial === 'boolean') {
    lines.push(`isPartial: ${(metadata as ProcessingMetadata & { isPartial: boolean }).isPartial}`)
  }

  // 只在价格未知时才写这一行：已知价格的文件保持与 CLI 的历史契约逐字一致
  if (metadata.pricingKnown === false) {
    lines.push('pricingKnown: false')
  }


  // 每行按 `key: value` 拆开后只转义 value，key 都是固定字面量
  const safeLines = lines.map((line) => {
    const idx = line.indexOf(':')
    return `${line.slice(0, idx)}: ${escapeMetadataValue(line.slice(idx + 1).trim())}`
  })

  return `<!--\n${safeLines.join('\n')}\n-->`
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
 * 文件头元数据注释：只认文件开头（允许 BOM / 前导空白）的第一个 `<!--\n ... \n-->` 块，
 * 正文中出现的其它 HTML 注释一律忽略。
 */
const HEADER_COMMENT_RE = /^\uFEFF?\s*<!--[ \t]*\r?\n([\s\S]*?)\r?\n-->/
const HEADER_COMMENT_STRIP_RE = /^\uFEFF?\s*<!--[ \t]*\r?\n[\s\S]*?\r?\n-->(?:[ \t]*\r?\n)*/

/** 写入注释的值：去换行、转义 `-->`，防止提前闭合注释 */
export function escapeMetadataValue(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/-->/g, '--&gt;')
}

/** 读取注释值：还原 escapeMetadataValue 的转义 */
export function unescapeMetadataValue(value: string): string {
  return value.replace(/--&gt;/g, '-->')
}

type StringField = 'source' | 'fileName' | 'processedAt' | 'model' | 'chapterDetectionMode' | 'selectedChapters'
type IntField =
  | 'chapterCount'
  | 'originalCharCount'
  | 'processedCharCount'
  | 'inputTokens'
  | 'outputTokens'
  | 'skippedChapters'
  | 'selectedChapterCount'

const STRING_FIELDS = new Set<string>(['source', 'fileName', 'processedAt', 'model', 'chapterDetectionMode', 'selectedChapters'])
const INT_FIELDS = new Set<string>([
  'chapterCount',
  'originalCharCount',
  'processedCharCount',
  'inputTokens',
  'outputTokens',
  'skippedChapters',
  'selectedChapterCount',
])

/**
 * 从文件内容中解析元数据（前端唯一实现，cloudCacheService 委托至此）
 * @param content 文件内容
 * @returns 解析出的元数据或 null
 */
export function parseMetadataFromContent(content: string): ProcessingMetadata | null {
  const commentMatch = typeof content === 'string' ? content.match(HEADER_COMMENT_RE) : null
  if (!commentMatch) return null

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
  }

  for (const line of commentMatch[1].split(/\r?\n/)) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    const value = unescapeMetadataValue(line.slice(colonIndex + 1).trim())

    if (STRING_FIELDS.has(key)) {
      metadata[key as StringField] = value
    } else if (INT_FIELDS.has(key)) {
      metadata[key as IntField] = parseInt(value, 10) || 0
    } else if (key === 'costUSD' || key === 'costRMB') {
      metadata[key] = parseFloat(value) || 0
    } else if (key === 'isPartial') {
      metadata.isPartial = value === 'true'
    } else if (key === 'epubTocDepth') {
      metadata.epubTocDepth = value === 'N/A' ? undefined : parseInt(value, 10) || undefined
    }
  }

  return metadata
}

/**
 * 从文件内容中移除文件头元数据备注（只移除开头那一块）
 * @param content 包含备注的文件内容
 * @returns 纯 Markdown 内容
 */
export function stripMetadataFromContent(content: string): string {
  return content.replace(HEADER_COMMENT_STRIP_RE, '')
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
  /**
   * 关键图表结构化数据（序列化为 ## 关键图表 下 fenced json）
   * 运行时为 BookCharts 对象；不强制依赖 charts 包以免循环引用
   */
  charts?: Record<string, unknown> | null
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
 * 6. 关键图表用二级标题 `## 关键图表` + fenced json（可选）
 * 7. 章节摘要用二级标题 `## 章节摘要`
 * 8. 各章节用三级标题 `### 第X章 章节名`
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

  // 失败 / 跳过占位不写入云端：只保留可用章节；有失败内容时元数据标记 isPartial，
  // 读取方据此不把它当完整缓存（单书 autoSync 与批量引擎都经过这里）
  const chapters = data.chapters.filter((ch) => !isPlaceholderText(ch.summary))
  const overallSummary = isPlaceholderText(data.overallSummary) ? '' : data.overallSummary
  const connections = isPlaceholderText(data.connections) ? '' : data.connections
  const hasFailure =
    data.chapters.some((ch) => isFailedText(ch.summary)) ||
    isFailedText(data.overallSummary) ||
    isFailedText(data.connections)
  data = { ...data, chapters, overallSummary, connections }
  if (metadata && hasFailure && metadata.isPartial !== true) {
    metadata = { ...metadata, isPartial: true }
  }

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

  // 6. 关键图表 - fenced JSON（便于云端回放）
  if (data.charts && typeof data.charts === 'object') {
    lines.push('## 关键图表')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(data.charts, null, 2))
    lines.push('```')
    lines.push('')
  }

  // 7. 章节摘要 - 二级标题
  if (data.chapters.length > 0) {
    lines.push('## 章节摘要')
    lines.push('')

    // 8. 各章节 - 三级标题
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
 * 从统一 Markdown 中提取关键图表 JSON（云存档回放用）
 */
export function extractChartsFromMarkdown(
  cleanContent: string
): Record<string, unknown> | null {
  // 1) ## 关键图表 + ```json ... ```
  const fence = cleanContent.match(
    /##[ \t]+关键图表\s*\n+```(?:json)?\s*\n?([\s\S]*?)```/i
  )
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1].trim()) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through
    }
  }

  // 2) ## 关键图表 到下一标准二级标题之间的首个 {…}
  const section = cleanContent.match(
    /##[ \t]+关键图表\s*\n+([\s\S]*?)(?=\n##[ \t]+(?:全书总结|章节关联分析|章节摘要)|$)/i
  )
  if (section?.[1]) {
    const body = section[1].trim()
    const start = body.indexOf('{')
    if (start >= 0) {
      let depth = 0
      let inStr = false
      let esc = false
      for (let i = start; i < body.length; i++) {
        const ch = body[i]
        if (inStr) {
          if (esc) esc = false
          else if (ch === '\\') esc = true
          else if (ch === '"') inStr = false
          continue
        }
        if (ch === '"') {
          inStr = true
          continue
        }
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) {
            try {
              const parsed = JSON.parse(body.slice(start, i + 1)) as unknown
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
              }
            } catch {
              break
            }
          }
        }
      }
    }
  }

  return null
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
  content = content.replace(/\r\n?/g, '\n') // CRLF（Windows 编辑器 / 旧版 CLI 产物）会让下方依赖 \n\n 的正则失效
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

  // 顶层区块：仅在「标准二级标题」处切分，避免全书总结正文里的 ## 一、… 被误切
  // 注意：中文后勿用 \b（JS 的 \b 只认 [A-Za-z0-9_]，对中文标题会失效）
  const SECTION_STOP = String.raw`\n##[ \t]+(?:全书总结|章节关联分析|关键图表|章节摘要)(?:\s|$)`

  // 解析全书总结
  const overallSummaryMatch = cleanContent.match(
    new RegExp(String.raw`##[ \t]+全书总结\s*\n+([\s\S]*?)(?=${SECTION_STOP}|$)`)
  )
  if (overallSummaryMatch) {
    data.overallSummary = overallSummaryMatch[1].trim()
  }

  // 解析章节关联分析
  const connectionsMatch = cleanContent.match(
    new RegExp(String.raw`##[ \t]+章节关联分析\s*\n+([\s\S]*?)(?=${SECTION_STOP}|$)`)
  )
  if (connectionsMatch) {
    data.connections = connectionsMatch[1].trim()
  }

  // 解析关键图表（## 关键图表 下 fenced json，或区块内裸 JSON）
  data.charts = extractChartsFromMarkdown(cleanContent)

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
  parseUnified: parseUnifiedMarkdown,
  extractCharts: extractChartsFromMarkdown,
}
