/**
 * EPUB 处理类型定义
 * @deprecated 请从 @/types 导入
 */

// 从统一类型定义重新导出，保持向后兼容
export type {
  ChapterData,
  EpubChapterData as ChapterDataEpub,
  BookData,
  EpubBookData as BookDataEpub,
  ChapterInfo,
  ChapterNamingMode,
  ChapterDetectionMode,
} from '../../types/chapter'

// 为保持向后兼容，保留原始导出
export type { NavItem } from '@ssshooter/epubjs'
