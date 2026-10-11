/**
 * 版本化缓存键：内容指纹 + 模型 + prompt + 语言 + bookType + 处理类型 共同决定，
 * 任何一项变化都不会命中旧结果。
 */
import { CACHE_KEY_PREFIX } from '@/services/cacheService'

/** 键结构版本：缓存语义变化时递增，旧条目自然失效（随 LRU 淘汰） */
export const CACHE_SCHEMA_VERSION = 1
/** 文件指纹读取的头部字节数 */
export const FINGERPRINT_HEAD_BYTES = 64 * 1024

export type CacheKind =
  | 'summary'
  | 'mindmap'
  | 'connections'
  | 'overall_summary'
  | 'key_charts'
  | 'combined_mindmap'

function getSubtle(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null
}

/** 当前环境是否可计算 SHA-256（非安全上下文下 crypto.subtle 不可用，缓存随之停用） */
export function canHash(): boolean {
  return getSubtle() !== null
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = getSubtle()
  if (!subtle) throw new Error('crypto.subtle 不可用')
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
  return toHex(await subtle.digest('SHA-256', bytes as BufferSource))
}

/** 读取 Blob；旧环境（含 jsdom）无 Blob.arrayBuffer 时走 FileReader */
async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export interface FingerprintSource {
  size: number
  lastModified?: number
  /** 文件头（≤64KB）；传 Blob 时自动截取 */
  head: Blob | ArrayBuffer | Uint8Array
}

/** 文件指纹：size + lastModified + 前 64KB 的 SHA-256 */
export async function fileFingerprint(source: FingerprintSource | File): Promise<string> {
  const src: FingerprintSource =
    source instanceof Blob
      ? { size: source.size, lastModified: (source as File).lastModified, head: source }
      : source
  let head = src.head
  if (head instanceof Blob) head = await readBlob(head.slice(0, FINGERPRINT_HEAD_BYTES))
  else head = (head instanceof Uint8Array ? head : new Uint8Array(head)).slice(0, FINGERPRINT_HEAD_BYTES)
  const headHash = await sha256Hex(head)
  const full = await sha256Hex(`${src.size}|${src.lastModified ?? 0}|${headHash}`)
  return full.slice(0, 32)
}

/** 某本书全部条目的前缀 */
export function bookPrefix(bookId: string): string {
  return `${CACHE_KEY_PREFIX}${bookId}:`
}

/** 某类（可选某章）条目的前缀；用于按新键清除单章 / 某类缓存 */
export function entryPrefix(bookId: string, kind: CacheKind, slot?: string): string {
  return `${bookPrefix(bookId)}${kind}:${slot === undefined ? '' : `${encodeURIComponent(slot)}:`}`
}

/** 构造条目键：slot 仅作分组（章节 id 或 '_'），正确性由 parts 的哈希保证 */
export async function buildEntryKey(
  bookId: string,
  kind: CacheKind,
  slot: string,
  parts: readonly unknown[]
): Promise<string> {
  const digest = await sha256Hex(JSON.stringify([CACHE_SCHEMA_VERSION, kind, ...parts]))
  return `${entryPrefix(bookId, kind, slot)}${digest.slice(0, 40)}`
}

/** 无本地文件（云端 / 历史加载）时按云端文件名分组的书 id */
export async function nameBookId(fileName: string): Promise<string> {
  return `name-${(await sha256Hex(fileName)).slice(0, 24)}`
}
