/**
 * 纯文本类书籍（.txt / .md）当作书来处理。
 *
 * 背景：WebDAV 文件浏览器与书库都会列出 `.txt` / `.md`（`BOOK_EXTENSIONS`），批量处理也一直
 * 允许它们（`pipeline/batchItem.ts` 的「不支持的格式按纯文本处理」），但**单本处理**曾经直接
 * 抛「不支持的文件格式，请选择 EPUB 或 PDF」——用户点了书库里的 .txt 就报错。
 *
 * 这里给出与批量一致的落地方式：没有解析器，正文就是文件本身。.md 额外按一二级标题切章
 * （有结构就顺着结构走），没有标题就整篇一章，标题用文件名（无扩展名），本地化无关。
 */
import type { ChapterData } from '@/types/chapter'
import type { BookData } from '@/types/chapter'

/** 纯文本书籍：没有 epub/pdf 的解析资源可释放 */
export interface PlainBookData extends BookData {
  plain: true
}

export type PlainBook = PlainBookData & { chapters: ChapterData[] }

/** `书名.epub` → `书名`；没有扩展名就用原样（去掉路径分隔符后的部分） */
export function plainBookTitle(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const stem = base.replace(/\.[^.]+$/, '').trim()
  return stem || base.trim() || fileName
}

/** `\r\n` / 单独的 `\r` 都折成 `\n`，再去掉可能残留的 BOM */
const normalizeNewlines = (text: string): string => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

/** UTF-16 的 BOM：有它就不必猜，直接按对应端序解 */
function utf16Bom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return null
}

/** 按指定编码**严格**解码：只要有一个字节不合法就返回 null（不吐替换符） */
function decodeStrict(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 字节 → 文本：UTF-16 认 BOM；否则先按**严格** UTF-8 试，失败了才当 GBK 系中文 txt
 * 按 GB18030（GBK / GB2312 的超集）严格解，两者都不合法时退回 UTF-8 的替换符结果。
 *
 * 为什么不用「替换符占比」猜编码（旧做法，被独立审查实测出两个坑）：
 * - 书里出现「□」等 U+FFFD 占位符是合法的 UTF-8 文本，旧逻辑会把它当成编码坏了，
 *   整篇按 GB18030 重解成「锟斤拷」——**把好文件解坏**；
 * - 占位符密度的分母两端不一致（JS 用 UTF-16 长度、Python 用码点），同一份文件两端
 *   会得到不同的解码结果。
 * 严格解码只回答「这份字节是不是合法 UTF-8」，与两端无关，也与占位符多少无关。
 *
 * 代价：合法 UTF-8 里混进一个非法字节时，整篇会改按 GB18030 解（若它能严格解开）。
 * 这种坏文件本来就无从猜，宁可两端一致也不要各自猜一半。
 * 与 CLI 的 `src/cli/plain_text.py#read_plain_text` **同规则**（契约 `tests/fixtures/plain-text-cases.json`）。
 */
export function decodePlainText(bytes: Uint8Array): string {
  const utf16 = utf16Bom(bytes)
  if (utf16) return normalizeNewlines(new TextDecoder(utf16).decode(bytes))

  const utf8 = decodeStrict(bytes, 'utf-8')
  if (utf8 !== null) return normalizeNewlines(utf8)

  const gb = decodeStrict(bytes, 'gb18030')
  if (gb !== null) return normalizeNewlines(gb)

  return normalizeNewlines(new TextDecoder('utf-8').decode(bytes))
}

/**
 * 读成文本。编码判定见 `decodePlainText`：
 * UTF-8 优先，UTF-16 认 BOM，非 UTF-8 的中文 txt 回退 GB18030。
 */
export async function readPlainText(file: Blob): Promise<string> {
  return decodePlainText(new Uint8Array(await readBytes(file)))
}

/** jsdom 的 Blob 既没有 arrayBuffer 也没有 text：退回 FileReader（浏览器里走上面的快路径） */
async function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return await file.arrayBuffer()
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 与 JS `\s` / `String.trim()` **同一集合**，显式写出来是为了与 CLI 对齐：
 * Python 的 `\s` 与 `str.strip()` 还会认 U+001C–U+001F 与 U+0085，
 * 不写死会让「`正文\u0085`」「`#\u001c标题`」这种行两端切章不同。
 */
const WS = '\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'

/** markdown 一二级标题（行尾的 # 允许省略或带空格） */
const HEADING = new RegExp(`^#{1,2}[${WS}]+(.+?)[${WS}]*#*[${WS}]*$`)

/**
 * 切章：一二级标题各起一章，标题里的 `#` 与行尾装饰去掉；标题前的前导内容（前言）也算一章。
 * 一个标题都没有（纯 txt、或 md 里只用三级以下标题）时整篇一章。
 */
export function splitPlainText(content: string, fallbackTitle: string): ChapterData[] {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const chapters: ChapterData[] = []
  let title: string | null = null
  let buffer: string[] = []

  const flush = () => {
    const body = buffer.join('\n').trim()
    buffer = []
    // 空的前导内容、或「连续两个标题」这种空段：不生成空章节
    if (!body) return
    chapters.push({ id: String(chapters.length + 1), title: title ?? fallbackTitle, content: body })
  }

  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (!heading) {
      buffer.push(line)
      continue
    }
    flush()
    title = heading[1].trim()
  }
  flush()

  return chapters.length ? chapters : [{ id: '1', title: fallbackTitle, content: text.trim() }]
}
