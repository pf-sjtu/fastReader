/**
 * 章节相关类型定义
 * 统一 EPUB 和 PDF 的章节类型
 */

import type { Book, NavItem } from '@ssshooter/epubjs'

// ==================== 基础章节类型 ====================

/**
 * 基础章节数据接口
 */
export interface ChapterData {
  id: string
  title: string
  content: string
}

/**
 * EPUB 章节数据（扩展基础类型）
 */
export interface EpubChapterData extends ChapterData {
  /** EPUB 文件内的链接 */
  href?: string
  /** 目录项信息 */
  tocItem?: NavItem
  /** 目录层级深度 */
  depth?: number
}

/**
 * PDF 章节数据（扩展基础类型）
 */
export interface PdfChapterData extends ChapterData {
  /** 起始页码 */
  startPage?: number
  /** 结束页码 */
  endPage?: number
  /** 页面索引 */
  pageIndex?: number
}

/**
 * 带摘要的章节（用于 AI 处理）
 */
export interface ChapterWithSummary extends ChapterData {
  summary?: string
}

// ==================== 书籍类型 ====================

/**
 * 基础书籍数据接口
 */
export interface BookData {
  title: string
  author: string
}

/**
 * EPUB 书籍数据
 */
export interface EpubBookData extends BookData {
  /** EPUB.js Book 实例 */
  book: Book
}

/**
 * 带章节的 EPUB 书籍数据
 */
export interface EpubBookDataWithChapters extends EpubBookData {
  chapters: EpubChapterData[]
}

/**
 * PDF 书籍数据
 */
export interface PdfBookData extends BookData {
  /** 总页数 */
  totalPages: number
  /** PDF.js 文档实例 */
  pdfDocument?: any
}

/**
 * 带章节的 PDF 书籍数据
 */
export interface PdfBookDataWithChapters extends PdfBookData {
  chapters: PdfChapterData[]
}

// ==================== 章节处理类型 ====================

/**
 * 章节信息（用于目录解析）
 */
export interface ChapterInfo {
  title: string
  href: string
  subitems?: NavItem[]
  tocItem: NavItem
  depth: number
}

/**
 * 章节命名模式
 * - auto: 自动命名
 * - numbered: 数字编号（如：第01章）
 */
export type ChapterNamingMode = 'auto' | 'numbered'

/**
 * 章节检测模式
 * - normal: 正常模式（使用目录）
 * - smart: 智能检测
 * - epub-toc: EPUB 目录层级模式
 */
export type ChapterDetectionMode = 'normal' | 'smart' | 'epub-toc'

// ==================== 向后兼容导出 ====================

/** @deprecated 使用 EpubChapterData 或 PdfChapterData */
export type ChapterDataLegacy = EpubChapterData
