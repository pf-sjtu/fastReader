/**
 * 文件处理工具函数
 */

/**
 * 根据文件名获取MIME类型
 */
export function getMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop()

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
