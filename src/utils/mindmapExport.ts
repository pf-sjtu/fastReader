/**
 * 思维导图导出：mind-elixir 实例 → 目标格式。
 *
 * mind-elixir 5.x 只直接提供 `exportPng()` 与 `exportSvg()`；JPEG/WEBP 通过 canvas 二次编码，
 * HTML 内嵌 SVG，Markdown 由导图数据递归生成（便于贴进文档给模型继续处理）。
 */
import type { MindElixirData, MindElixirInstance, NodeObj } from 'mind-elixir'
import { triggerBlobDownload, triggerTextDownload } from './download'

export type MindMapExportFormat = 'PNG' | 'JPEG' | 'WEBP' | 'SVG' | 'HTML' | 'JSON' | 'MARKDOWN'

export interface MindMapExportResult {
  filename: string
}

function safeName(title: string): string {
  return (title || 'mindmap').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
}

async function pngBlobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('PNG 解码失败'))
      image.src = url
    })
    return image
  } finally {
    // 图片解码完成后再 revoke（image 已持有解码结果）
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

async function convertPng(blob: Blob, mime: 'image/jpeg' | 'image/webp', quality = 0.92): Promise<Blob> {
  const image = await pngBlobToImage(blob)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  // JPEG 无 alpha，先铺白底避免出现黑块
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(image, 0, 0)
  const converted = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), mime, quality)
  )
  if (!converted) throw new Error('图片编码失败')
  return converted
}

function svgBlobToHtml(svg: Blob, title: string): Promise<string> {
  return svg.text().then(
    (svgText) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { overflow: auto; }
  svg { display: block; height: auto; max-width: 100%; }
</style>
</head>
<body>
${svgText}
</body>
</html>
`
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 导图数据 → 嵌套 Markdown 列表（首节点为标题） */
export function mindMapDataToMarkdown(data: MindElixirData): string {
  const lines: string[] = []
  const walk = (node: NodeObj, depth: number) => {
    const topic = (node.topic || '').trim()
    if (topic) {
      const indent = '  '.repeat(depth)
      lines.push(`${indent}- ${topic}`)
    }
    for (const child of node.children ?? []) {
      walk(child, topic ? depth + 1 : depth)
    }
  }

  const root = data.nodeData
  const title = (root?.topic || 'mindmap').trim()
  lines.push(`# ${title}`, '')
  for (const child of root?.children ?? []) {
    walk(child, 0)
  }

  if (data.summaries && data.summaries.length > 0) {
    lines.push('', '## 章节总结标注', '')
    for (const summary of data.summaries) {
      lines.push(`- ${summary.label}`)
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * 导出思维导图到本地文件。
 *
 * @param instance mind-elixir 实例
 * @param title 文件名（不含扩展名）
 * @param format 目标格式
 */
export async function exportMindMap(
  instance: MindElixirInstance,
  title: string,
  format: MindMapExportFormat | string
): Promise<MindMapExportResult> {
  const base = safeName(title)
  const normalized = String(format || 'PNG').toUpperCase() as MindMapExportFormat

  switch (normalized) {
    case 'JSON': {
      const data = instance.getData()
      triggerTextDownload(JSON.stringify(data, null, 2), `${base}.json`, 'application/json;charset=utf-8', false)
      return { filename: `${base}.json` }
    }

    case 'MARKDOWN': {
      const data = instance.getData()
      triggerTextDownload(mindMapDataToMarkdown(data), `${base}.md`, 'text/markdown;charset=utf-8', false)
      return { filename: `${base}.md` }
    }

    case 'SVG': {
      const svg = instance.exportSvg()
      triggerBlobDownload(svg, `${base}.svg`)
      return { filename: `${base}.svg` }
    }

    case 'HTML': {
      const svg = instance.exportSvg()
      const html = await svgBlobToHtml(svg, title)
      triggerTextDownload(html, `${base}.html`, 'text/html;charset=utf-8', false)
      return { filename: `${base}.html` }
    }

    case 'JPEG':
    case 'WEBP': {
      const png = await instance.exportPng()
      if (!png) throw new Error('导出图片失败')
      const mime = normalized === 'JPEG' ? 'image/jpeg' : 'image/webp'
      const ext = normalized === 'JPEG' ? 'jpg' : 'webp'
      const converted = await convertPng(png, mime)
      triggerBlobDownload(converted, `${base}.${ext}`)
      return { filename: `${base}.${ext}` }
    }

    case 'PNG':
    default: {
      const png = await instance.exportPng()
      if (!png) throw new Error('导出图片失败')
      triggerBlobDownload(png, `${base}.png`)
      return { filename: `${base}.png` }
    }
  }
}
