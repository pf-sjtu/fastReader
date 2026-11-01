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

/**
 * 读成文本。固定按 UTF-8 解码：这是电子书里最常见的编码；
 * GBK 的 txt 会得到乱码，属于已知取舍（浏览器没有可靠的编码嗅探）。
 */
export async function readPlainText(file: Blob): Promise<string> {
  const raw = new TextDecoder('utf-8').decode(await readBytes(file))
  // BOM 会变成正文第一个字符，进提示词与统计都不好看
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
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
