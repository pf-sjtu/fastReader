/**
 * EPUB 文本提取
 */

import { cleanAndFormatText } from './utils'
import { extractContentByAnchorImproved, extractContentByAnchorRegex } from './anchorExtractor'

/**
 * 从 XHTML 内容中提取文本
 */
export function extractTextFromXHTML(xhtmlContent: string, anchor?: string): { textContent: string } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml')

    // 检查解析错误
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      throw new Error('DOM解析失败')
    }

    // 提取正文内容
    const body = doc.querySelector('body')
    if (!body) {
      throw new Error('未找到body元素')
    }

    // 移除脚本和样式标签
    const scripts = body.querySelectorAll('script, style')
    scripts.forEach(el => el.remove())

    let textContent = ''

    // 如果有锚点，尝试定位到锚点位置并提取相关内容
    if (anchor) {
      textContent = extractContentByAnchor(doc, anchor)
    }

    // 如果锚点定位失败或没有锚点，提取全部内容
    if (!textContent.trim()) {
      textContent = body.textContent || ''
    }

    // 清理和格式化文本内容
    textContent = cleanAndFormatText(textContent)

    return { textContent }
  } catch (error) {
    console.warn('DOM解析失败，使用正则表达式备选方案:', error)
    // 如果DOM解析失败，使用正则表达式作为备选方案
    return extractTextWithRegex(xhtmlContent, anchor)
  }
}

/**
 * 从锚点元素提取内容
 */
function extractContentByAnchor(doc: Document, anchor: string): string {
  try {
    // 转义锚点中的特殊字符
    const escapedAnchor = CSS.escape(anchor)

    // 查找锚点元素
    let anchorElement: Element | null = null
    try {
      anchorElement = doc.querySelector(`[id="${escapedAnchor}"]`)
    } catch { /* ignore */ }

    if (!anchorElement) {
      try {
        anchorElement = doc.querySelector(`[name="${escapedAnchor}"]`)
      } catch { /* ignore */ }
    }

    if (!anchorElement) {
      try {
        anchorElement = doc.querySelector(`[id*="${escapedAnchor}"]`)
      } catch { /* ignore */ }
    }

    if (!anchorElement) {
      // 如果转义后还是找不到，尝试原始锚点
      const originalAnchorElement = doc.querySelector(`[id*="${anchor}"]`) ||
                                   doc.querySelector(`[name="${anchor}"]`)
      if (originalAnchorElement) {
        return extractContentFromElement(originalAnchorElement)
      }
      return ''
    }

    // 获取整个HTML内容用于正则表达式匹配
    const htmlContent = new XMLSerializer().serializeToString(doc)

    // 使用改进的锚点提取策略
    return extractContentByAnchorImproved(htmlContent, anchor)

  } catch (error) {
    console.warn('锚点内容提取失败:', error)
    return ''
  }
}

/**
 * 从锚点元素提取内容（辅助函数）
 */
function extractContentFromElement(anchorElement: Element): string {
  // 获取锚点元素之后的所有内容
  let content = ''
  let currentElement: Element | null = anchorElement.nextElementSibling

  while (currentElement) {
    content += currentElement.textContent + '\n'
    currentElement = currentElement.nextElementSibling
  }

  // 如果没有找到后续元素，获取锚点元素的内容
  if (!content.trim()) {
    content = anchorElement.textContent || ''
  }

  return cleanAndFormatText(content.trim())
}

/**
 * 使用正则表达式提取文本（备选方案）
 */
function extractTextWithRegex(xhtmlContent: string, anchor?: string): { title: string; textContent: string } {
  // 移除XML声明和DOCTYPE
  let cleanContent = xhtmlContent
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  // 移除脚本和样式标签及其内容
  cleanContent = cleanContent
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  // 如果有锚点，尝试用正则表达式提取锚点内容
  let textContent = ''
  if (anchor) {
    textContent = extractContentByAnchorRegex(cleanContent, anchor)
  }

  // 如果锚点提取失败或没有锚点，提取全部内容
  if (!textContent.trim()) {
    // 提取标题
    const titleMatch = cleanContent.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? cleanAndFormatText(titleMatch[1]) : ''

    // 提取正文内容
    const bodyMatch = cleanContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) {
      textContent = bodyMatch[1]
    } else {
      textContent = cleanContent
    }

    // 移除HTML标签并清理文本
    textContent = textContent.replace(/<[^>]*>/g, ' ')
    textContent = cleanAndFormatText(textContent)

    return { title, textContent }
  } else {
    // 锚点提取成功，清理文本
    textContent = cleanAndFormatText(textContent)
    return { title: '', textContent }
  }
}
