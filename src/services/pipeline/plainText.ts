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

const REPLACEMENT = /\uFFFD/g
const countBroken = (text: string): number => (text.match(REPLACEMENT) ?? []).length

/** UTF-16 的 BOM：有它就不必猜，直接按对应端序解 */
function utf16Bom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return null
}

/**
 * 字节 → 文本。默认 UTF-8（电子书里最常见）；UTF-16 带 BOM 时按 BOM 解；
 * UTF-8 解出**大量**替换符（说明多半是 GBK 系的中文 txt）时，再按 GB18030（GBK/GB2312 的超集）试一次，
 * 取替换符更少的那份——否则整本乱码会照常进 AI 流程白花额度。
 *
 * 只在坏字符超过 1% 时才回退：正文里偶尔一个坏字节不该把整篇猜坏。
 */
export function decodePlainText(bytes: Uint8Array): string {
  const utf16 = utf16Bom(bytes)
  if (utf16) return normalizeNewlines(new TextDecoder(utf16).decode(bytes))

  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const broken = countBroken(utf8)
  if (broken === 0 || utf8.length === 0) return normalizeNewlines(utf8)

  if (broken / utf8.length > 0.01) {
    try {
      const gb = new TextDecoder('gb18030').decode(bytes)
      if (countBroken(gb) < broken) return normalizeNewlines(gb)
    } catch {
      // 运行环境没有该编码（缺 ICU）时保持 UTF-8 结果，不抛
    }
  }
  return normalizeNewlines(utf8)
}

/**
 * 读成文本。编码判定见 `decodePlainText`：
 * UTF-8 优先，UTF-16 认 BOM，疑似 GBK 的中文 txt 回退 GB18030。
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

/** markdown 一二级标题（行尾的 # 允许省略或带空格） */
const HEADING = /^#{1,2}\s+(.+?)\s*#*\s*$/

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
