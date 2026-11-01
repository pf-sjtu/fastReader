/**
 * 文件处理工具函数
 */

/** 文件名归一化：小写、去首尾空白、全角点转半角（兼容大小写与全角扩展名） */
function normalizeName(file: File | null | undefined): string {
  return (file?.name || '')
    .toLowerCase()
    .trim()
    .replace(/．/g, '.') // 全角点
}

/**
 * 识别电子书格式（兼容全角点、MIME、大小写）
 */
export function detectBookFormat(file: File): 'epub' | 'pdf' | null {
  const name = normalizeName(file)
  const type = (file?.type || '').toLowerCase()

  if (name.endsWith('.epub') || type.includes('epub')) return 'epub'
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf'
  return null
}

/**
 * 纯文本类书籍：没有解析器，正文就是文件本身（见 `services/pipeline/plainText.ts`）。
 * WebDAV 文件浏览器与书库都列出 .txt/.md，所以这里必须认它们，否则用户一点就报「不支持的文件格式」。
 * MIME 只认 text/plain 与 markdown：`text/html` 之类的标签文本按纯文本读出来是源码，不是书。
 */
const PLAIN_TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown'])

export function isPlainTextBook(file: File | null | undefined): boolean {
  const name = normalizeName(file)
  const type = (file?.type || '').toLowerCase().split(';')[0].trim()
  return /\.(txt|md|markdown)$/.test(name) || PLAIN_TEXT_TYPES.has(type)
}

/**
 * 根据文件名获取MIME类型
 */
export function getMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().replace(/．/g, '.').split('.').pop()

  switch (extension) {
    case 'pdf':
      return 'application/pdf'
    case 'epub':
      return 'application/epub+zip'
    case 'txt':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'json':
      return 'application/json'
    case 'yaml':
    case 'yml':
      return 'application/yaml'
    default:
      return 'application/octet-stream'
  }
}

/**
 * 将文件转换为ArrayBuffer
 */
export function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(new Error('文件读取结果不是ArrayBuffer'))
      }
    }

    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * 将文件转换为文本
 */
export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('文件读取结果不是文本'))
      }
    }

    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }

    reader.readAsText(file)
  })
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
}

/**
 * 验证文件类型
 */
export function isValidBookFile(fileName: string): boolean {
  const validExtensions = ['.epub', '.pdf', '.txt', '.md']
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
  return validExtensions.includes(extension)
}

/**
 * 从URL提取文件名
 */
export function extractFileNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const segments = pathname.split('/')
    return decodeURIComponent(segments[segments.length - 1] || '')
  } catch {
    // URL解析失败，尝试从字符串提取
    const segments = url.split('/')
    return decodeURIComponent(segments[segments.length - 1] || '')
  }
}

/**
 * 清理文件名中的非法字符
 */
export function sanitizeFileName(fileName: string): string {
  // 移除或替换Windows/Unix的非法字符
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}
