/**
 * 产物信封：速读 / 自测 / 笔记在 WebDAV 上的统一存档格式（设计见 `docs/artifact-store.md`）。
 *
 * 为什么要有它：这三类东西要么花了钱（速读 / 自测的 AI 调用），要么是用户亲手写的（划线 / 批注 / 答题记录），
 * 只存在一台设备的浏览器里，换设备、清缓存、换浏览器就没了。
 *
 * 约定：
 * - 路径 `{syncPath}/.juhua/books/{bookFolder}/{kind}.json.gz`；本机 IndexedDB 只当缓存。
 * - `bookKey` 是**稳定**的书身份（书名|作者）：重新生成总结不换目录，否则旧目录没人认领。
 * - `inputsFp` 是**上游指纹**：速读 / 自测的上游是各章总结（`studyKeyOf`），总结重生成指纹就变；
 *   笔记是用户数据，没有上游，恒为空串。过时判定只有这一条：`inputsFp ≠ 当前指纹`。
 * - 读到 `schema` 更高的信封：能读的当不存在（`bad`），并且**不许覆盖**（见 io.saveArtifact）。
 *
 * 本文件是纯数据与纯函数（无 IO、无 React），IO 在 `io.ts`。
 */

/** 信封格式版本。加字段不必升版本（读侧逐字段清洗）；改变语义才升 */
export const ARTIFACT_SCHEMA = 2

/** 信封都放同步目录下的隐藏目录，不与书籍文件、`{名}-完整摘要.md` 混在一起 */
export const ARTIFACT_DIR = '.juhua/books'

export type ArtifactKind = 'study' | 'quiz' | 'notes'

export interface ArtifactEnvelope<T = unknown> {
  /** 格式版本；读到更高的版本只读不写 */
  schema: number
  kind: ArtifactKind
  /** 书的稳定身份 `${title}|${author}` */
  bookKey: string
  title: string
  author?: string
  /** 上游指纹：速读 / 自测 = 各章总结指纹；笔记 = '' */
  inputsFp: string
  /** 章节数：拿不到章节总结时的粗比对（换过一轮章节也能看出来） */
  chapterCount?: number
  model?: string
  promptVersion?: string
  createdAt: number
  updatedAt: number
  data: T
}

export interface EnvelopeInput<T> {
  kind: ArtifactKind
  bookKey: string
  title: string
  author?: string
  inputsFp?: string
  chapterCount?: number
  model?: string
  promptVersion?: string
  data: T
  now: number
  /** 更新同一条时保留首次生成时间 */
  createdAt?: number
}

/** 书的稳定身份：重新生成总结不会换目录 */
export const bookKeyOf = (book: { title?: string; author?: string }): string =>
  `${book.title ?? ''}|${book.author ?? ''}`

/** FNV-1a 32 位，输出 base36。同一输入永远同一结果：指纹、目录名都靠它 */
export function fnv1a(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/**
 * WebDAV 路径里不能出现的字符（Windows 禁用集 + 控制字符）。
 * 含 `%`：目录名一旦带百分号，清理侧的 `decodeURIComponent` 校验就没法把它与编码过的恶意名字区分开，
 * 只能整包拒删——所以干脆不让目录名出现它（哈希照旧按 bookKey 算，不受清洗影响）。
 */
const UNSAFE_PATH = /[\\/:*?"<>|\u0000-\u001f%]+/g

/**
 * 信封目录名：书名（可读，便于在网盘里翻找）+ `~哈希`（去重、且不受书名清洗影响）。
 * 只依赖 bookKey，与内容无关——重生成总结不会换目录。
 */
export function bookFolderOf(bookKey: string): string {
  const title = bookKey.split('|')[0] ?? ''
  const stem = title.replace(UNSAFE_PATH, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 48) || 'book'
  return `${stem}~${fnv1a(bookKey)}`
}

const trimSlashes = (p: string) => p.replace(/\/+$/, '') || ''

/** `{syncPath}/.juhua/books/{folder}` */
export const artifactDirOf = (syncPath: string, bookKey: string): string =>
  `${trimSlashes(syncPath) || ''}/${ARTIFACT_DIR}/${bookFolderOf(bookKey)}`

/** `{syncPath}/.juhua/books/{folder}/{kind}.json.gz` */
export const artifactPath = (syncPath: string, bookKey: string, kind: ArtifactKind): string =>
  `${artifactDirOf(syncPath, bookKey)}/${kind}.json.gz`

export function buildEnvelope<T>(input: EnvelopeInput<T>): ArtifactEnvelope<T> {
  return {
    schema: ARTIFACT_SCHEMA,
    kind: input.kind,
    bookKey: input.bookKey,
    title: input.title,
    ...(input.author ? { author: input.author } : {}),
    inputsFp: input.inputsFp ?? '',
    ...(typeof input.chapterCount === 'number' ? { chapterCount: input.chapterCount } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.promptVersion ? { promptVersion: input.promptVersion } : {}),
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
    data: input.data,
  }
}

export type ParsedEnvelope<T = unknown> =
  | { status: 'ok'; env: ArtifactEnvelope<T> }
  /** 写入端比我们新：能看懂的部分不用，写入方也必须放弃覆盖 */
  | { status: 'newer'; schema: number }
  | { status: 'bad'; reason: string }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 把外面读到的任意值收敛成信封。读不懂的一律 `bad`——调用方当「没有这份存档」处理，
 * 既不报错打断流程，也不拿残缺数据覆盖云端。
 */
export function parseEnvelope<T = unknown>(raw: unknown, kind: ArtifactKind): ParsedEnvelope<T> {
  if (!isRecord(raw)) return { status: 'bad', reason: 'not-object' }
  const schema = typeof raw.schema === 'number' ? raw.schema : NaN
  if (!Number.isFinite(schema) || schema < 1) return { status: 'bad', reason: 'bad-schema' }
  if (schema > ARTIFACT_SCHEMA) return { status: 'newer', schema }
  if (raw.kind !== kind) return { status: 'bad', reason: 'kind-mismatch' }
  if (typeof raw.bookKey !== 'string' || !raw.bookKey) return { status: 'bad', reason: 'bad-book-key' }
  return {
    status: 'ok',
    env: {
      schema,
      kind,
      bookKey: raw.bookKey,
      title: typeof raw.title === 'string' ? raw.title : '',
      ...(typeof raw.author === 'string' && raw.author ? { author: raw.author } : {}),
      inputsFp: typeof raw.inputsFp === 'string' ? raw.inputsFp : '',
      ...(typeof raw.chapterCount === 'number' ? { chapterCount: raw.chapterCount } : {}),
      ...(typeof raw.model === 'string' && raw.model ? { model: raw.model } : {}),
      ...(typeof raw.promptVersion === 'string' && raw.promptVersion ? { promptVersion: raw.promptVersion } : {}),
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      data: raw.data as T,
    },
  }
}

export function parseEnvelopeText<T = unknown>(text: string, kind: ArtifactKind): ParsedEnvelope<T> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { status: 'bad', reason: 'invalid-json' }
  }
  return parseEnvelope<T>(raw, kind)
}

export const serializeEnvelope = (env: ArtifactEnvelope<unknown>): string => JSON.stringify(env)

/** 过时判定只有这一条：上游指纹与当前不符。任一为空都无从判定（不算过时） */
export const isInputsStale = (envInputsFp: string, currentInputsFp: string): boolean =>
  !!envInputsFp && !!currentInputsFp && envInputsFp !== currentInputsFp
