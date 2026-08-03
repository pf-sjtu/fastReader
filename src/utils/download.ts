/**
 * 浏览器端文件下载工具
 */

/**
 * 触发 Blob 下载（兼容 Safari：延迟 revoke）
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  // Safari 需要延迟 revoke，否则可能下到空文件
  window.setTimeout(() => {
    if (link.parentNode) {
      document.body.removeChild(link)
    }
    URL.revokeObjectURL(url)
  }, 250)
}

/**
 * 触发文本文件下载（默认 UTF-8，带 BOM 以兼容 Windows 记事本中文）
 */
export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8',
  withBom = true
): void {
  const bom = withBom ? '\uFEFF' : ''
  const blob = new Blob([bom + content], { type: mimeType })
  triggerBlobDownload(blob, filename)
}
