/** 书库：WebDAV 同步目录下的书籍索引（`{syncPath}/.juhua/library.json`） */

export const LIBRARY_SCHEMA_VERSION = 1
/** 索引文件体积上限（字节）；超出时淘汰最久未打开的条目 */
export const LIBRARY_MAX_BYTES = 2 * 1024 * 1024
/** 源文件连续缺席多少次扫描后才从索引删除（避免一次网络抖动就丢条目） */
export const MISSING_SCANS_BEFORE_GC = 2

/** unprocessed 未处理 · partial 只有部分章节 · done 已有完整摘要 */
export type BookStatus = 'unprocessed' | 'partial' | 'done'

export interface ReadProgress {
  chapterId: string
  /** 0–100 */
  pct: number
}

export interface LibraryEntry {
  /** 源文件在 WebDAV 上的完整路径（主键） */
  path: string
  size: number
  /** 源文件 lastmod（ISO 或 HTTP 日期原文） */
  mtime: string
  etag?: string
  /** 标题/作者：未补全前用文件名兜底 */
  title: string
  author?: string
  chapterCount?: number
  wordCount?: number
  status: BookStatus
  /** 摘要文件名（status≠unprocessed 时有） */
  summaryFile?: string
  /** 元数据已过期（源文件变了），下次打开或空闲时重新提取 */
  stale: boolean
  /** 连续缺席的扫描次数；>0 说明上次扫描没看到源文件 */
  missingScans: number
  lastOpenedAt?: number
  readProgress?: ReadProgress
  /** 条目最后一次被修改的时间（合并时以此为准） */
  updatedAt: number
}

export interface LibraryIndex {
  schemaVersion: number
  updatedAt: number
  entries: Record<string, LibraryEntry>
}

/** 扫描得到的一个源文件（WebDAV PROPFIND 结果的子集） */
export interface ScannedFile {
  path: string
  size: number
  mtime: string
  etag?: string
}
