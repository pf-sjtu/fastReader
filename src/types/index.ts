/**
 * 统一类型导出
 * 集中导出所有类型定义，便于其他模块使用
 */

// ==================== 章节相关 ====================
export type {
  ChapterData,
  EpubChapterData,
  PdfChapterData,
  ChapterWithSummary,
  BookData,
  EpubBookData,
  EpubBookDataWithChapters,
  PdfBookData,
  PdfBookDataWithChapters,
  ChapterInfo,
  ChapterNamingMode,
  ChapterDetectionMode,
  ChapterDataLegacy,
} from './chapter'

// ==================== AI 相关 ====================
export type {
  AIProviderType,
  AIProviderConfig,
  AIServiceOptions,
  PromptConfig,
  GenerateContentRequest,
  GenerateContentResponse,
  RateLimitError,
  AIProvider,
  AIProviderConstructor,
  MindMapNode,
  LanguageInstructionProvider,
} from './ai'

// ==================== 元数据相关 ====================
export type {
  AIResponseInfo,
  ProcessingMetadata,
  MetadataFormatterOptions,
  ChapterSummary,
  BookDataForFormatting,
  CacheFileMetadata,
} from './metadata'

// ==================== 批量处理相关 ====================
export type {
  BatchProcessingResult,
  BatchProcessingSummary,
  BatchProcessingCallbacks,
  BatchProcessingStatus,
  BatchDownloadResult,
} from './batch'
