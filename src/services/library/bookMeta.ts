/**
 * 轻量元数据提取（书名/作者），专为书库"补全"用。
 * 刻意不复用 EpubProcessor/PdfProcessor：它们会登记并持有已打开的书（供当前处理流程销毁），
 * 后台补全若共用会和用户正在处理的书互相干扰。
 *
 * EPUB 本质是 ZIP：只读 META-INF/container.xml → OPF，不解压正文，也不依赖 epubjs/jszip。
 */

export interface BookMeta {
  title?: string
  author?: string
  /** PDF 页数 */
  pages?: number
  /** EPUB 内嵌封面原图（尚未缩放；缩略图在 coverThumb） */
  cover?: { bytes: Uint8Array; mime: string }
}

import { pipeBytes } from './gzip'

/* ---------- 极简 ZIP 读取（仅支持 stored / deflate，足够读 EPUB 的两个小文件） ---------- */

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localOffset: number
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const u32 = (v: DataView, o: number) => v.getUint32(o, true)

export function listZipEntries(buf: ArrayBuffer): Map<string, ZipEntry> {
  const v = new DataView(buf)
  // 末尾 EOCD 签名 0x06054b50；注释最长 65535，向前搜
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP')
  const count = u16(v, eocd + 10)
  let p = u32(v, eocd + 16)
  const dec = new TextDecoder()
  const out = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.byteLength || u32(v, p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = u16(v, p + 10)
    const compressedSize = u32(v, p + 20)
    const nameLen = u16(v, p + 28)
    const extraLen = u16(v, p + 30)
    const commentLen = u16(v, p + 32)
    const localOffset = u32(v, p + 42)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    out.set(name, { name, method, compressedSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await pipeBytes(data, new DecompressionStream('deflate-raw')))
}

export async function readZipBytes(buf: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(buf)
  if (u32(v, entry.localOffset) !== 0x04034b50) throw new Error('ZIP 本地头损坏')
  const start = entry.localOffset + 30 + u16(v, entry.localOffset + 26) + u16(v, entry.localOffset + 28)
  const raw = new Uint8Array(buf, start, entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRaw(raw)
  throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}`)
}

export async function readZipText(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  return new TextDecoder().decode(await readZipBytes(buf, entry))
}

/* ---------- EPUB ---------- */

const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined

export function parseOpfMeta(opfXml: string): BookMeta {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml')
  if (doc.querySelector('parsererror')) return {}
  // 命名空间前缀各家不同（dc:title / opf:title…）：按 localName 取
  const first = (name: string) =>
    Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === name)?.textContent
  const creators = Array.from(doc.getElementsByTagName('*'))
    .filter((e) => e.localName === 'creator')
    .map((e) => clean(e.textContent))
    .filter((s): s is string => !!s)
  return { title: clean(first('title')), author: creators.length ? creators.join('、') : undefined }
}

/** 相对路径解析：OPF 里的 href 相对 OPF 所在目录，且可能带 ../ 与 URL 编码 */
export function resolveZipPath(opfPath: string, href: string): string {
  const base = opfPath.split('/').slice(0, -1)
  for (const seg of decodeURI(href.split('#')[0]).split('/')) {
    if (seg === '..') base.pop()
    else if (seg && seg !== '.') base.push(seg)
  }
  return base.join('/')
}

/**
 * 找封面图在包内的 href（相对 OPF）。顺序：EPUB3 properties="cover-image" →
 * EPUB2 <meta name="cover" content="manifest-id"> → id/href 含 "cover" 的图片。找不到返回 null。
 */
export function findCoverHref(opfXml: string): { href: string; mime: string } | null {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml')
  if (doc.querySelector('parsererror')) return null
  const all = Array.from(doc.getElementsByTagName('*'))
  const items = all.filter((e) => e.localName === 'item')
  const isImage = (e: Element) => (e.getAttribute('media-type') ?? '').startsWith('image/')
  const pick = (e: Element | undefined) =>
    e && e.getAttribute('href') ? { href: e.getAttribute('href')!, mime: e.getAttribute('media-type') ?? 'image/jpeg' } : null

  const v3 = items.find((e) => (e.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'))
  if (v3) return pick(v3)
  const coverId = all.find((e) => e.localName === 'meta' && e.getAttribute('name') === 'cover')?.getAttribute('content')
  const v2 = coverId ? items.find((e) => e.getAttribute('id') === coverId && isImage(e)) : undefined
  if (v2) return pick(v2)
  return pick(items.find((e) => isImage(e) && /cover/i.test(`${e.getAttribute('id')} ${e.getAttribute('href')}`)))
}

export async function readEpubMeta(buf: ArrayBuffer): Promise<BookMeta> {
  const entries = listZipEntries(buf)
  const container = entries.get('META-INF/container.xml')
  if (!container) throw new Error('缺少 container.xml')
  const containerDoc = new DOMParser().parseFromString(await readZipText(buf, container), 'application/xml')
  const opfPath = Array.from(containerDoc.getElementsByTagName('*'))
    .find((e) => e.localName === 'rootfile')
    ?.getAttribute('full-path')
  if (!opfPath) throw new Error('找不到 OPF 路径')
  const opf = entries.get(decodeURIComponent(opfPath)) ?? entries.get(opfPath)
  if (!opf) throw new Error('找不到 OPF 文件')
  const opfXml = await readZipText(buf, opf)
  const meta = parseOpfMeta(opfXml)
  // 封面是锦上添花：任何一步失败都不影响书名/作者
  try {
    const c = findCoverHref(opfXml)
    const entry = c && entries.get(resolveZipPath(opfPath, c.href))
    if (c && entry) meta.cover = { bytes: await readZipBytes(buf, entry), mime: c.mime }
  } catch {
    /* ignore */
  }
  return meta
}

/* ---------- PDF（懒加载 pdfjs，只读 info） ---------- */

export async function readPdfMeta(buf: ArrayBuffer): Promise<BookMeta> {
  // 导入 pdfProcessor 仅为其设置 pdf.js worker 的副作用
  await import('../pdfProcessor')
  const pdfjs = await import('pdfjs-dist')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise
  try {
    const info = (await doc.getMetadata()).info as { Title?: string; Author?: string } | undefined
    return { title: clean(info?.Title), author: clean(info?.Author), pages: doc.numPages }
  } finally {
    await doc.destroy()
  }
}

/** 按扩展名分发；txt/md 没有内嵌元数据，返回空（标题沿用文件名） */
export async function extractBookMeta(buf: ArrayBuffer, path: string): Promise<BookMeta> {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'epub') return readEpubMeta(buf)
  if (ext === 'pdf') return readPdfMeta(buf)
  return {}
}
