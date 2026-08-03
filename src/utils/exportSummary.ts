/**
 * 书籍摘要导出（Markdown / PDF）
 */

import { metadataFormatter } from '@/services/metadataFormatter'
import { prepareMarkdownForRender } from '@/lib/markdown'
import { sanitizeFileName } from '@/utils/file'
import { triggerTextDownload, triggerBlobDownload } from '@/utils/download'
import type { BookSummary } from '@/hooks/useBookProcessing'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

export interface BuildSummaryMarkdownOptions {
  bookSummary: BookSummary
  /** 原始文件名（含扩展名）；无文件时可用书名 */
  fileName?: string | null
  model?: string
  chapterDetectionMode?: string
  chapterNamingMode?: 'auto' | 'numbered'
  epubTocDepth?: number
  /** 是否做渲染前清洗（默认 true） */
  prepareForRender?: boolean
}

/**
 * 根据书名/文件名生成导出基名（不含扩展名）
 */
export function getSummaryExportBaseName(
  bookSummary: BookSummary,
  fileName?: string | null
): string {
  const fromFile = fileName?.replace(/\.[^/.]+$/, '').trim()
  const raw = fromFile || bookSummary.title || 'summary'
  return sanitizeFileName(raw) || 'summary'
}

/**
 * 从 BookSummary 生成统一格式 Markdown
 * 不依赖 File 对象（历史/云缓存加载后也可导出）
 */
export function buildSummaryMarkdown(options: BuildSummaryMarkdownOptions): string {
  const {
    bookSummary,
    fileName,
    model = 'unknown',
    chapterDetectionMode = 'normal',
    chapterNamingMode = 'auto',
    epubTocDepth,
    prepareForRender = true,
  } = options

  const chapters = bookSummary.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    summary: chapter.summary || '',
  }))

  const bookData = {
    title: bookSummary.title,
    author: bookSummary.author,
    chapters,
    overallSummary: bookSummary.overallSummary,
    connections: bookSummary.connections,
    charts: bookSummary.charts
      ? (bookSummary.charts as unknown as Record<string, unknown>)
      : null,
  }

  const originalCharCount = bookSummary.chapters.reduce(
    (total, chapter) => total + (chapter.content?.length || 0),
    0
  )
  const processedCharCount = bookSummary.chapters.reduce(
    (total, chapter) => total + (chapter.summary?.length || 0),
    0
  )
  const selectedChapterIndices = bookSummary.chapters
    .map((_, index) => index + 1)
    .filter((_, index) => !!bookSummary.chapters[index]?.summary)

  const metadata: ProcessingMetadata = metadataFormatter.generate({
    fileName: fileName || `${bookSummary.title || 'summary'}.md`,
    bookTitle: bookSummary.title,
    model,
    chapterDetectionMode,
    epubTocDepth,
    selectedChapters: selectedChapterIndices,
    chapterCount: bookSummary.chapters.length,
    originalCharCount,
    processedCharCount,
  })

  let markdownContent = metadataFormatter.formatUnified(
    bookData,
    metadata,
    chapterNamingMode
  )

  if (prepareForRender) {
    markdownContent = prepareMarkdownForRender(markdownContent)
  }

  return markdownContent
}

/**
 * 下载完整摘要 Markdown
 */
export function downloadSummaryMarkdown(
  options: BuildSummaryMarkdownOptions
): { fileName: string } {
  const content = buildSummaryMarkdown(options)
  const base = getSummaryExportBaseName(options.bookSummary, options.fileName)
  const fileName = `${base}_总结.md`
  triggerTextDownload(content, fileName, 'text/markdown;charset=utf-8', true)
  return { fileName }
}

const TABLE_STYLE =
  'width:100%;border-collapse:collapse;margin:12px 0 16px;font-size:12px;line-height:1.45;table-layout:auto;'
const TH_STYLE =
  'border:1px solid #dddddd;background:#f5f5f5;padding:6px 8px;text-align:left;font-weight:600;color:#111111;vertical-align:top;'
const TD_STYLE =
  'border:1px solid #dddddd;padding:6px 8px;text-align:left;color:#222222;vertical-align:top;word-break:break-word;'
const HR_STYLE =
  'border:none;border-top:1px solid #dddddd;margin:18px 0;height:0;'

function splitMarkdownTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

/** 是否为 GFM 表头分隔行：|---|:---|---:| */
function isMarkdownTableSeparator(line: string): boolean {
  const t = line.trim()
  if (!t || !t.includes('-') || !t.includes('|')) return false
  const cells = splitMarkdownTableCells(t)
  if (cells.length < 2) return false
  // 每个单元格仅为 --- / :--- / ---: / :---:
  return cells.every((c) => /^:?-{1,}:?$/.test(c))
}

/** 是否像表格数据行（含 |，且不是分隔行） */
function isMarkdownTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  if (isMarkdownTableSeparator(t)) return false
  // 至少两列
  return splitMarkdownTableCells(t).length >= 2
}

/**
 * 将连续 GFM 表格块转为 HTML table（行内样式，兼容 html2canvas）
 */
export function convertMarkdownTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const next = i + 1 < lines.length ? lines[i + 1] : ''

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(next)) {
      const headerCells = splitMarkdownTableCells(line)
      i += 2 // skip header + separator
      const bodyRows: string[][] = []
      while (i < lines.length && isMarkdownTableRow(lines[i])) {
        bodyRows.push(splitMarkdownTableCells(lines[i]))
        i += 1
      }

      const thead = `<thead><tr>${headerCells
        .map((c) => `<th style="${TH_STYLE}">${c}</th>`)
        .join('')}</tr></thead>`
      const tbody = `<tbody>${bodyRows
        .map((cells) => {
          // 列数对齐表头
          const padded = headerCells.map((_, idx) => cells[idx] ?? '')
          return `<tr>${padded
            .map((c) => `<td style="${TD_STYLE}">${c}</td>`)
            .join('')}</tr>`
        })
        .join('')}</tbody>`

      out.push(`<table style="${TABLE_STYLE}">${thead}${tbody}</table>`)
      continue
    }

    out.push(line)
    i += 1
  }

  return out.join('\n')
}

/** 水平线 / 常见分页分隔符 --- *** ___ */
export function convertMarkdownHorizontalRules(text: string): string {
  return text.replace(
    /^[ \t]*([-*_])\1{2,}[ \t]*$/gm,
    `<hr style="${HR_STYLE}" />`
  )
}

/**
 * 将统一 Markdown 转成适合打印的简易 HTML（支持常见 GFM 结构）
 * 含：标题、粗斜体、引用、列表、**表格**、**水平线**
 */
export function markdownToPrintableHtml(markdown: string): string {
  // 去掉文件头 HTML 注释元数据
  const body = markdown.replace(/^<!--[\s\S]*?-->\s*/m, '').trim()

  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 先保护 fenced code
  const codeBlocks: string[] = []
  let text = escaped.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const idx = codeBlocks.length
    codeBlocks.push(
      `<pre style="background:#f5f5f5;padding:10px 12px;border-radius:6px;overflow:auto;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${code
        .replace(/^\w*\n/, '')
        .trim()}</code></pre>`
    )
    return `\u0000CODE${idx}\u0000`
  })

  // 行内 code（在表格转换前，避免 `a|b` 被拆）
  text = text.replace(
    /`([^`\n]+)`/g,
    '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>'
  )

  // 标题
  text = text
    .replace(
      /^### (.+)$/gm,
      '<h3 style="font-size:15px;margin:18px 0 8px;color:#222222;">$1</h3>'
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 style="font-size:17px;margin:22px 0 10px;border-bottom:1px solid #e5e5e5;padding-bottom:4px;color:#111111;">$1</h2>'
    )
    .replace(
      /^# (.+)$/gm,
      '<h1 style="font-size:22px;margin:0 0 12px;color:#000000;">$1</h1>'
    )

  // 粗体 / 斜体（表格单元格内一并处理）
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')

  // GFM 表格（须在段落 <br> 化之前）
  text = convertMarkdownTables(text)

  // 水平线 --- *** ___（须在列表 `- item` 之前）
  text = convertMarkdownHorizontalRules(text)

  // 引用
  text = text.replace(
    /^&gt;\s?(.*)$/gm,
    '<blockquote style="margin:8px 0;padding:6px 12px;border-left:3px solid #cccccc;color:#444444;background:#fafafa;">$1</blockquote>'
  )

  // 无序列表（- / * 后须有空白，避免吃掉 ---）
  text = text.replace(/^[-*]\s+(.+)$/gm, '<li style="margin:2px 0;">$1</li>')
  text = text.replace(/(<li[\s\S]*?<\/li>\n?)+/g, (block) => {
    return `<ul style="margin:8px 0;padding-left:1.4em;">${block}</ul>`
  })

  // 段落：双换行；已是块级 HTML 的不包 <p>
  text = text
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim()
      if (!trimmed) return ''
      if (/^<(h[1-3]|ul|ol|li|pre|blockquote|table|hr)\b/i.test(trimmed)) {
        return trimmed
      }
      // 块内若混有 table/hr，按行保留块级元素
      if (/<(table|hr)\b/i.test(trimmed)) {
        return trimmed
          .split('\n')
          .map((line) => {
            const l = line.trim()
            if (!l) return ''
            if (/^<(h[1-3]|ul|ol|li|pre|blockquote|table|hr)\b/i.test(l)) return l
            return `<p style="margin:8px 0;line-height:1.7;color:#222222;">${l}</p>`
          })
          .filter(Boolean)
          .join('\n')
      }
      return `<p style="margin:8px 0;line-height:1.7;color:#222222;">${trimmed.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')

  // 还原 code blocks
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, n) => codeBlocks[Number(n)] ?? '')

  return text
}

/** PDF 导出用空白文档样式：仅 hex/rgb，禁止 oklch（html2canvas 不支持） */
const PDF_EXPORT_DOC_STYLE = `
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #222222;
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.7;
  }
  #root {
    width: 720px;
    padding: 28px 32px 40px;
    box-sizing: border-box;
    background: #ffffff;
    color: #222222;
    text-align: left;
  }
`

/**
 * 在隔离 iframe 中挂载导出 HTML，避免继承主站 Tailwind oklch 变量。
 * html2canvas 解析 oklch 会直接抛错（Chrome + Tailwind v4 场景必现）。
 */
function mountPdfExportFrame(htmlBody: string, titleLine: string): {
  iframe: HTMLIFrameElement
  root: HTMLElement
  cleanup: () => void
} {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('data-export-pdf-frame', '1')
  iframe.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:760px',
    'height:1200px',
    'border:0',
    'opacity:0',
    'pointer-events:none',
  ].join(';')
  document.body.appendChild(iframe)

  const idoc = iframe.contentDocument
  if (!idoc) {
    document.body.removeChild(iframe)
    throw new Error('无法创建 PDF 导出文档')
  }

  idoc.open()
  idoc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>${PDF_EXPORT_DOC_STYLE}</style>
</head>
<body>
<div id="root">
  <div style="font-size:11px;color:#888888;margin-bottom:16px;">${titleLine}</div>
  ${htmlBody}
</div>
</body>
</html>`)
  idoc.close()

  const root = idoc.getElementById('root')
  if (!root) {
    document.body.removeChild(iframe)
    throw new Error('PDF 导出根节点缺失')
  }

  return {
    iframe,
    root,
    cleanup: () => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
    },
  }
}

/**
 * 将长图按 A4 分页写入 jsPDF
 */
function addCanvasImageToPdf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  canvas: HTMLCanvasElement,
  marginX: number,
  marginY: number
): void {
  const pageWidth = doc.internal.pageSize.getWidth() as number
  const pageHeight = doc.internal.pageSize.getHeight() as number
  const contentWidth = pageWidth - marginX * 2
  const contentHeight = pageHeight - marginY * 2
  const imgHeight = (canvas.height * contentWidth) / canvas.width

  // JPEG 体积更小；白底内容几乎无损
  const imgData = canvas.toDataURL('image/jpeg', 0.92)

  let heightLeft = imgHeight
  let yOffset = 0
  let pageIndex = 0

  while (heightLeft > 0) {
    if (pageIndex > 0) {
      doc.addPage()
    }
    // 负 y：向上滚动长图，露出下一页区域
    const y = marginY - yOffset
    doc.addImage(imgData, 'JPEG', marginX, y, contentWidth, imgHeight, undefined, 'FAST')
    yOffset += contentHeight
    heightLeft -= contentHeight
    pageIndex += 1
    // 安全上限，防止异常死循环
    if (pageIndex > 200) break
  }
}

/**
 * 下载完整摘要 PDF（浏览器端：隔离 iframe HTML → html2canvas → jsPDF）
 * 使用系统字体渲染中文，避免嵌入巨型中文字体包。
 * jspdf / html2canvas 按需动态加载。
 *
 * 注意：必须隔离主站 CSS。Tailwind v4 使用 oklch()，html2canvas 无法解析会抛错。
 */
export async function downloadSummaryPdf(
  options: BuildSummaryMarkdownOptions
): Promise<{ fileName: string }> {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])
  const html2canvas = html2canvasMod.default

  const markdown = buildSummaryMarkdown(options)
  const base = getSummaryExportBaseName(options.bookSummary, options.fileName)
  const fileName = `${base}_总结.pdf`
  const htmlBody = markdownToPrintableHtml(markdown)
  const titleLine = `${escapeHtml(options.bookSummary.title || base)} · PDF 导出`

  const { root, cleanup } = mountPdfExportFrame(htmlBody, titleLine)

  try {
    // 等 iframe 布局稳定
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    const canvas = await html2canvas(root, {
      scale: 1.5,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      // 仅截取导出根节点，不带主文档样式表
      foreignObjectRendering: false,
      windowWidth: 720,
      onclone: (clonedDoc) => {
        // 双保险：去掉任何可能注入的外链/含 oklch 的样式
        clonedDoc
          .querySelectorAll('link[rel="stylesheet"], style[data-vite-dev-id]')
          .forEach((el) => el.remove())
        const body = clonedDoc.body
        if (body) {
          body.style.background = '#ffffff'
          body.style.color = '#222222'
        }
      },
    })

    const doc = new jsPDF({
      unit: 'pt',
      format: 'a4',
      compress: true,
    })
    addCanvasImageToPdf(doc, canvas, 36, 36)

    const blob = doc.output('blob')
    triggerBlobDownload(blob, fileName)
    return { fileName }
  } finally {
    cleanup()
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
