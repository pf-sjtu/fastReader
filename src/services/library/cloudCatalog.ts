/**
 * 云端书目（Cloudflare KV）与 WebDAV 书库索引的叠加：书架的数据来源。
 *
 *   书架 = WebDAV 扫描得到的真实条目（用云端 metadata 补全）∪ 云端有、WebDAV 尚无真实条目的「虚拟条目」
 *
 * 虚拟条目让书架在 WebDAV 还没连上（甚至没配置）时就能完整显示；它的路径是 `cloud://<id>/<文件名>`，
 * 永远不会被当成 WebDAV 路径用。点开时才去 WebDAV 解析真实文件（见 useLibraryOpen / libraryStore.resolveEntry）。
 * 这里只做内存里的纯计算，不写 library.json：云端数据是唯一事实来源，不在 WebDAV 上留第二份。
 */
import type { BookMeta } from './bookMeta'
import { bookIdOf, bookStem } from './bookId'
import { buildNormIndex, matchCoverId, type CoverIndex, type CoverItem, type CoverMeta } from './cloudCovers'
import type { LibraryEntry, LibraryIndex } from './types'

const VIRTUAL_PREFIX = 'cloud://'
export const virtualPath = (id: string, file: string) => `${VIRTUAL_PREFIX}${id}/${file}`
export const isVirtualPath = (path: string) => path.startsWith(VIRTUAL_PREFIX)

/**
 * 解析到的书籍信息 → 要写入云端的元数据。「补全」与「点开时补传」共用，保证云端条目字段一致。
 * title 用传入的兜底（占位词「未知…」不能覆盖已有书名）。
 */
export function buildCatalogMeta(path: string, size: number, meta: BookMeta, fallbackTitle: string): CoverMeta {
  const pick = (s?: string) => (s && !/^(未知|unknown)/i.test(s) ? s : undefined)
  return {
    stem: bookStem(path),
    title: pick(meta.title) ?? fallbackTitle,
    author: pick(meta.author),
    pages: meta.pages,
    chapterCount: meta.chapterCount,
    file: path.split('/').pop() || path,
    size: size || undefined,
    subjects: meta.subjects,
    desc: meta.desc,
    publisher: meta.publisher,
    year: meta.year,
    lang: meta.lang,
  }
}

const good = (s?: string) => (s && !/^(未知|unknown)/i.test(s) ? s : undefined)

/** 匹配缓存：同一份云端目录 + 同一路径的结果不变。模糊匹配是 O(书数 × 目录数)，不能每次渲染重算 */
const matchCache = new WeakMap<CoverIndex, { norm: Map<string, string>; byPath: Map<string, string | null> }>()

export function catalogIdOf(path: string, catalog: CoverIndex): string | null {
  let c = matchCache.get(catalog)
  if (!c) matchCache.set(catalog, (c = { norm: buildNormIndex(catalog), byPath: new Map() }))
  const hit = c.byPath.get(path)
  if (hit !== undefined) return hit
  const id = matchCoverId(path, catalog, c.norm)
  c.byPath.set(path, id)
  return id
}

function enrich(e: LibraryEntry, id: string, it: CoverItem): LibraryEntry {
  const next: LibraryEntry = { ...e, catalogId: id }
  // 标题 / 作者：真实条目没补全（stale）或缺作者时才用云端的；已经有的不覆盖
  // 云端已有这本书的资料：不再需要「下载整本书来补全」，stale 在叠加层里视为已解决
  if (e.stale && good(it.title)) {
    next.title = it.title
    next.stale = false
  }
  if (!next.author && good(it.author)) next.author = it.author
  if (!next.pages && it.pages) next.pages = it.pages
  if (!next.chapterCount && it.chapterCount) next.chapterCount = it.chapterCount
  if (it.cover && !(e.coverKey && e.coverKey.startsWith('bk_'))) next.coverKey = id
  if (it.subjects?.length) next.subjects = it.subjects
  if (it.desc) next.desc = it.desc
  if (it.publisher) next.publisher = it.publisher
  if (it.year) next.year = it.year
  if (it.lang) next.lang = it.lang
  return next
}

function virtualEntry(id: string, it: CoverItem): LibraryEntry {
  const file = it.file || `${it.stem || it.title}.epub`
  return {
    path: virtualPath(id, file),
    size: it.size ?? 0,
    mtime: '',
    title: good(it.title) ?? it.stem ?? file,
    author: good(it.author),
    pages: it.pages,
    chapterCount: it.chapterCount,
    coverKey: it.cover ? id : undefined,
    status: 'unprocessed',
    stale: false,
    missingScans: 0,
    updatedAt: it.updatedAt ?? 0,
    subjects: it.subjects,
    desc: it.desc,
    publisher: it.publisher,
    year: it.year,
    lang: it.lang,
    catalogId: id,
    virtual: true,
  }
}

/** 把云端书目叠加到书库索引上，得到书架用的索引。catalog 为空时原样返回（零开销） */
export function buildShelf(index: LibraryIndex, catalog: CoverIndex): LibraryIndex {
  if (Object.keys(catalog).length === 0) return index
  const entries: Record<string, LibraryEntry> = {}
  const matched = new Set<string>()
  for (const [path, e] of Object.entries(index.entries)) {
    const id = catalogIdOf(path, catalog)
    if (id) matched.add(id)
    entries[path] = id ? enrich(e, id, catalog[id]) : e
  }
  for (const [id, it] of Object.entries(catalog)) {
    if (matched.has(id)) continue
    const v = virtualEntry(id, it)
    entries[v.path] = v
  }
  return { ...index, entries }
}

/** 云端有而 WebDAV 上没有对应文件的书：只在「扫描成功且确实扫到了书」之后才可信，调用方负责判断 */
export const virtualEntries = (shelf: LibraryIndex): LibraryEntry[] => Object.values(shelf.entries).filter((e) => e.virtual)

/** 在（WebDAV）书库索引里找云端 id 对应的真实条目；找不到返回 null */
export function findRealEntry(index: LibraryIndex, catalog: CoverIndex, id: string): LibraryEntry | null {
  for (const e of Object.values(index.entries)) {
    if (e.virtual) continue
    if (bookIdOf(e.path) === id || catalogIdOf(e.path, catalog) === id) return e
  }
  return null
}

/** 分类统计：subject → 书数，数量降序（同数量按名称） */
export function categoryCounts(entries: readonly LibraryEntry[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const e of entries) for (const s of e.subjects ?? []) m.set(s, (m.get(s) ?? 0) + 1)
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** 主分类：第一个标签（EPUB 的 dc:subject 通常按相关度排列） */
export const primaryCategory = (e: LibraryEntry): string | undefined => e.subjects?.[0]
