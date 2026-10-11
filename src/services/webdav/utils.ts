import { buildWebdavPath } from '../webdavProxyUtils'
import { fileToArrayBuffer } from '../../utils/file'

/**
 * 所有传入路径都是相对 serverUrl 的绝对路径（如 `/Books/a.epub`、`{syncPath}/x.md`），原样使用。
 * browsePath 只是文件浏览器的「起始目录」，不参与拼接。
 * 返回未编码路径；编码统一在 setDavHeader / proxyFetch → encodeDavHeaderPath 完成，避免双重 encode。
 */
export function buildHeaderPath(path: string): string {
  return buildWebdavPath({ path })
}

/** 浏览器走同源 /api/dav 代理，非浏览器直连 */
export function getProcessedUrl(originalUrl: string): string {
  return typeof window !== 'undefined' ? '/api/dav' : originalUrl
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export function basicAuthHeader(username: string, password: string): string {
  // btoa 仅支持 latin1；密码含非 ASCII 时用 URI 转义兜底
  const raw = `${username}:${password}`
  try {
    return 'Basic ' + btoa(raw)
  } catch {
    const bin = encodeURIComponent(raw).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
    return 'Basic ' + btoa(bin)
  }
}

export function toUploadBody(data: string | ArrayBuffer | Blob): {
  body: BodyInit
  byteLength?: number
} {
  if (typeof data === 'string') {
    const bytes = new TextEncoder().encode(data)
    return { body: bytes, byteLength: bytes.byteLength }
  }
  if (data instanceof ArrayBuffer) {
    return { body: data, byteLength: data.byteLength }
  }
  return { body: data }
}

function sliceBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

/** 将 WebDAV 返回内容统一转换为 ArrayBuffer */
export async function normalizeToArrayBuffer(content: unknown): Promise<ArrayBuffer> {
  if (content instanceof ArrayBuffer) return content
  if (ArrayBuffer.isView(content)) return sliceBuffer(content)
  if (content instanceof Blob) {
    return fileToArrayBuffer(new File([content], 'webdav-download.bin'))
  }
  if (typeof content === 'string') {
    const binaryString = atob(content)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }
  return sliceBuffer(new Uint8Array(content as ArrayBufferLike))
}
