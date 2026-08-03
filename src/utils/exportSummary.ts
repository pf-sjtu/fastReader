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

/**
 * 将统一 Markdown 转成适合打印的简易 HTML（支持常见 GFM 结构）
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

  // 行内 code
  text = text.replace(/`([^`\n]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>')

  // 标题
  text = text
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;margin:18px 0 8px;color:#222;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;margin:22px 0 10px;border-bottom:1px solid #e5e5e5;padding-bottom:4px;color:#111;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:22px;margin:0 0 12px;color:#000;">$1</h1>')

  // 粗体 / 斜体（简化）
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')

  // 引用
  text = text.replace(
    /^&gt;\s?(.*)$/gm,
    '<blockquote style="margin:8px 0;padding:6px 12px;border-left:3px solid #ccc;color:#444;background:#fafafa;">$1</blockquote>'
  )

  // 无序列表
  text = text.replace(/^[-*]\s+(.+)$/gm, '<li style="margin:2px 0;">$1</li>')
  text = text.replace(/(<li[\s\S]*?<\/li>\n?)+/g, (block) => {
    return `<ul style="margin:8px 0;padding-left:1.4em;">${block}</ul>`
  })

  // 段落：双换行
  text = text
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim()
      if (!trimmed) return ''
      if (/^<(h[1-3]|ul|ol|li|pre|blockquote)/.test(trimmed)) return trimmed
      // 单换行转 <br>
      return `<p style="margin:8px 0;line-height:1.7;color:#222;">${trimmed.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')

  // 还原 code blocks
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, n) => codeBlocks[Number(n)] ?? '')

  return text
}

/**
 * 下载完整摘要 PDF（浏览器端：HTML 渲染 → jsPDF）
 * 使用系统字体渲染中文，避免嵌入巨型中文字体包。
 * jspdf 按需动态加载，避免拖大首屏包体积。
 */
export async function downloadSummaryPdf(
  options: BuildSummaryMarkdownOptions
): Promise<{ fileName: string }> {
  const { jsPDF } = await import('jspdf')

  const markdown = buildSummaryMarkdown(options)
  const base = getSummaryExportBaseName(options.bookSummary, options.fileName)
  const fileName = `${base}_总结.pdf`
  const htmlBody = markdownToPrintableHtml(markdown)

  const host = document.createElement('div')
  host.setAttribute('data-export-pdf-host', '1')
  // 固定排版宽度，离屏渲染（仍在 layout 树中以便 html2canvas 测量）
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:720px',
    'padding:28px 32px 40px',
    'box-sizing:border-box',
    'background:#ffffff',
    'color:#222222',
    "font-family:'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif",
    'font-size:13px',
    'line-height:1.7',
    'text-align:left',
    'z-index:-1',
  ].join(';')

  host.innerHTML = `
    <div style="font-size:11px;color:#888;margin-bottom:16px;">
      ${escapeHtml(options.bookSummary.title || base)} · PDF 导出
    </div>
    ${htmlBody}
  `
  document.body.appendChild(host)

  try {
    const doc = new jsPDF({
      unit: 'pt',
      format: 'a4',
      compress: true,
    })

    const pageWidth = doc.internal.pageSize.getWidth()
    const marginX = 40
    const marginY = 36
    const contentWidth = pageWidth - marginX * 2

    await doc.html(host, {
      x: marginX,
      y: marginY,
      width: contentWidth,
      windowWidth: 720,
      autoPaging: 'text',
      margin: [marginY, marginX, marginY, marginX],
      html2canvas: {
        scale: 0.85,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
    })

    const blob = doc.output('blob')
    triggerBlobDownload(blob, fileName)
    return { fileName }
  } finally {
    if (host.parentNode) {
      document.body.removeChild(host)
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
