/**
 * 封面缩略图（浏览器 canvas）：把任意封面原图/PDF 首页缩成约 144px 宽的 webp，
 * 单张通常 3–8KB（上限 16KB）：既够书架上看清，也能放心存 IndexedDB 与云端 KV。
 */

export const COVER_WIDTH = 144
const COVER_QUALITY = 0.55
/** 缩略图字节上限；超出就降质量再试一次，仍超出则放弃（回退生成式封面） */
export const COVER_MAX_BYTES = 16 * 1024

/** 按目标宽度等比算出缩略图尺寸（纯函数，便于单测）；原图更小时不放大 */
export function thumbSize(w: number, h: number, targetW = COVER_WIDTH): { width: number; height: number } {
  if (!w || !h) return { width: 0, height: 0 }
  const scale = Math.min(1, targetW / w)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const first = await canvasToBlob(canvas, COVER_QUALITY)
  if (first && first.size <= COVER_MAX_BYTES) return first
  const second = await canvasToBlob(canvas, 0.4)
  return second && second.size <= COVER_MAX_BYTES ? second : null
}

/** 封面原图 → 缩略图 webp；解码失败或过大返回 null */
export async function makeThumb(bytes: Uint8Array, mime: string): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
    const { width, height } = thumbSize(bmp.width, bmp.height)
    if (!width) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, width, height)
    bmp.close?.()
    return await encode(canvas)
  } catch {
    return null
  }
}

/** PDF 首页渲染成缩略图 */
export async function pdfFirstPageThumb(buf: ArrayBuffer): Promise<Blob | null> {
  try {
    await import('../pdfProcessor') // 仅为其设置 pdf.js worker
    const pdfjs = await import('pdfjs-dist')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const { width, height } = thumbSize(base.width, base.height)
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      return await encode(canvas)
    } finally {
      await doc.destroy()
    }
  } catch {
    return null
  }
}
