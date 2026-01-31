/**
 * EPUB 处理类型定义
 */

import type { Book, NavItem } from '@ssshooter/epubjs'

export interface ChapterData {
  id: string
  title: string
  content: string
  href?: string
  tocItem?: NavItem
  depth?: number
}

export interface BookData {
  book: Book
  title: string
  author: string
}

export interface ChapterInfo {
  title: string
  href: string
  subitems?: NavItem[]
  tocItem: NavItem
  depth: number
}

export type ChapterNamingMode = 'auto' | 'numbered'
export type ChapterDetectionMode = 'normal' | 'smart' | 'epub-toc'
