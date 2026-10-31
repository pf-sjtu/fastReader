/**
 * 书库元数据补全：对 stale 条目下载源文件 → 提取书名/作者/页数/封面 → 批量写回。
 * 用户主动触发（要下载整本书，流量不小），并发 2，可取消。
 *
 * 失败分类决定是否重试：
 * - 下载失败（网络）= 暂时性：保持 stale，下次还会试
 * - 解析失败/文件过大 = 确定性：清掉 stale，否则每次都会重复下载同一本打不开的书
 */
import { extractBookMeta, type BookMeta } from './bookMeta'
import { makeThumb, pdfFirstPageThumb } from './coverThumb'
import { titleFromPath } from './libraryIndex'
import { coverRemotePath, recordMetadataBatch, type LibraryIO } from './libraryService'
import type { LibraryEntry, LibraryIndex } from './types'

export const FILL_MAX_BYTES = 60 * 1024 * 1024
export const FILL_CONCURRENCY = 2
const FLUSH_EVERY = 5

/** 路径 → 稳定短键（FNV-1a 的 36 进制）。同一路径在任何设备上得到同一个封面文件名 */
export function coverKeyOf(path: string): string {
  let h = 2166136261
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export interface Inspection {
  meta: BookMeta
  thumb: Blob | null
}

/** 默认检查器：提取元数据 + 生成封面缩略图（EPUB 用内嵌封面，PDF 渲染首页） */
export async function inspectBook(buf: ArrayBuffer, path: string): Promise<Inspection> {
  const meta = await extractBookMeta(buf, path)
  const isPdf = path.toLowerCase().endsWith('.pdf')
  const thumb = meta.cover ? await makeThumb(meta.cover.bytes, meta.cover.mime) : isPdf ? await pdfFirstPageThumb(buf) : null
  return { meta, thumb }
}

export interface FillOptions {
  concurrency?: number
  maxBytes?: number
  signal?: AbortSignal
  inspect?: (buf: ArrayBuffer, path: string) => Promise<Inspection>
  onProgress?: (done: number, total: number) => void
}

export interface FillResult {
  total: number
  filled: number
  /** 暂时性失败（保持 stale，可重试） */
  retryable: number
  /** 确定性跳过（过大/解析失败，已清 stale） */
  skipped: number
  cancelled: boolean
  index: LibraryIndex | null
}

type Update = Parameters<typeof recordMetadataBatch>[1][number]

/** 书名里的"未知"占位不能覆盖文件名兜底 */
const usable = (s?: string) => (s && !/^(未知|unknown)/i.test(s) ? s : undefined)

export async function fillLibraryMetadata(io: LibraryIO, entries: readonly LibraryEntry[], opts: FillOptions = {}): Promise<FillResult> {
  const { concurrency = FILL_CONCURRENCY, maxBytes = FILL_MAX_BYTES, signal, inspect = inspectBook } = opts
  const queue = entries.filter((e) => e.stale)
  const res: FillResult = { total: queue.length, filled: 0, retryable: 0, skipped: 0, cancelled: false, index: null }
  let pending: Update[] = []
  // 封面上传串行化：WebDAV 对并发敏感，且这是尽力而为的附带动作，不该和下载抢连接
  let uploads: Promise<unknown> = Promise.resolve()
  let done = 0

  const flush = async () => {
    if (!pending.length) return
    const batch = pending
    pending = []
    res.index = (await recordMetadataBatch(io, batch)) ?? res.index
  }

  const one = async (e: LibraryEntry) => {
    if (e.size > maxBytes) {
      pending.push({ path: e.path, patch: { stale: false } })
      res.skipped++
      return
    }
    let buf: ArrayBuffer
    try {
      buf = await io.readBinary(e.path)
    } catch {
      res.retryable++
      return
    }
    try {
      const { meta, thumb } = await inspect(buf, e.path)
      let coverKey: string | undefined
      if (thumb) {
        coverKey = coverKeyOf(e.path)
        await io.putLocalCover(coverKey, thumb)
        // 跨设备共享：尽力而为，失败不影响本机
        const remote = coverRemotePath(io.syncPath, coverKey)
        uploads = uploads.then(() => io.writeBinary(remote, thumb)).catch(() => {})
      }
      pending.push({
        path: e.path,
        patch: {
          // 仅在拿到可用值时才覆盖，否则保留文件名兜底
          title: usable(meta.title) ?? (e.title || titleFromPath(e.path)),
          author: usable(meta.author),
          pages: meta.pages,
          coverKey,
          stale: false,
        },
      })
      res.filled++
    } catch {
      pending.push({ path: e.path, patch: { stale: false } })
      res.skipped++
    }
  }

  let next = 0
  const worker = async () => {
    while (next < queue.length && !signal?.aborted) {
      const e = queue[next++]
      await one(e)
      opts.onProgress?.(++done, queue.length)
      if (pending.length >= FLUSH_EVERY) await flush()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  await flush()
  await uploads
  res.cancelled = !!signal?.aborted && next < queue.length
  return res
}

