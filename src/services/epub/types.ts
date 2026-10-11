/**
 * EPUB 处理类型定义
 * @deprecated 请从 @/types 导入
 */

// 从统一类型定义重新导出，保持向后兼容
// EPUB 处理器产出的章节/书籍带 href/tocItem/depth 与 book 实例，故此处 ChapterData/BookData 指 EPUB 扩展类型
export type {
  EpubChapterData as ChapterData,
  EpubChapterData as ChapterDataEpub,
  EpubBookData as BookData,
  EpubBookData as BookDataEpub,
  ChapterInfo,
  ChapterNamingMode,
  ChapterDetectionMode,
} from '../../types/chapter'

// 为保持向后兼容，保留原始导出
export type { NavItem } from '@ssshooter/epubjs'
