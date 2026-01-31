/**
 * EPUB 处理器模块
 * 重构后的主入口文件
 */

export type {
  ChapterData,
  BookData,
  ChapterInfo,
  ChapterNamingMode,
  ChapterDetectionMode
} from './types'

export {
  formatChapterNumber,
  escapeRegExp,
  cleanAndFormatText,
  cleanChapterTitle
} from './utils'

export {
  extractContentByAnchorImproved,
  extractContentByAnchorRegex
} from './anchorExtractor'
