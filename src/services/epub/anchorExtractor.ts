/**
 * EPUB 锚点内容提取
 */

import { cleanAndFormatText } from './utils'

/**
 * 使用改进的策略从锚点提取内容
 * 提取锚点元素及其后续内容直到下一个标题
 */
export function extractContentByAnchorImproved(htmlContent: string, anchor: string): string {
  try {
    // 策略1：查找锚点元素并提取完整内容（包括锚点本身和后续内容到下一个标题）
    const headingMatch = htmlContent.match(new RegExp(`<(h[1-6]|div|p|section)[^>]*\\bid=["']${anchor}["'][^>]*>`, 'i'))
    if (headingMatch) {
      const anchorStart = htmlContent.indexOf(headingMatch[0])
      const tagName = headingMatch[1]
      const endTag = `</${tagName}>`
      const endTagPos = htmlContent.indexOf(endTag, anchorStart + headingMatch[0].length)

      if (endTagPos !== -1) {
        // 获取锚点元素内容
        let fullContent = htmlContent.substring(anchorStart, endTagPos + endTag.length)

        // 获取锚点元素之后的文本，直到下一个同级或更高级标题
        const afterElement = htmlContent.substring(endTagPos + endTag.length)
        const nextHeadingMatch = afterElement.match(/<(h[1-6])[^>]*>/i)

        if (nextHeadingMatch) {
          const nextHeadingLevel = parseInt(nextHeadingMatch[1].charAt(1))
          const currentLevel = parseInt(tagName.charAt(1)) || 99

          // 如果下一个标题级别小于等于当前级别，则只取到该标题之前
          if (nextHeadingLevel <= currentLevel) {
            const nextHeadingPos = afterElement.indexOf(nextHeadingMatch[0])
            fullContent += afterElement.substring(0, nextHeadingPos)
          }
        }

        const content = fullContent
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

        if (content.length > 20) {
          return cleanAndFormatText(content)
        }
      }
    }

    // 策略2：回退到简单匹配（标题文本）
    const simpleMatch = htmlContent.match(new RegExp(`<(h[1-6]|div|p|section)[^>]*id=["']${anchor}["'][^>]*>(.*?)</\\1>`, 'is'))
    if (simpleMatch) {
      const content = simpleMatch[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      if (content.length > 10) {
        return cleanAndFormatText(content)
      }
    }

    // 策略3：查找锚点后的内容到下一个标题
    const anchorElementMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${anchor}["'][^>]*>.*?</[^>]*>`, 'is'))
    if (anchorElementMatch) {
      const anchorStart = htmlContent.indexOf(anchorElementMatch[0])
      const afterAnchor = htmlContent.substring(anchorStart + anchorElementMatch[0].length)

      const nextHeadingMatch = afterAnchor.match(/<h[1-6][^>]*>/i)
      const endIndex = nextHeadingMatch && nextHeadingMatch[0] ? afterAnchor.indexOf(nextHeadingMatch[0]) : afterAnchor.length

      const content = afterAnchor.substring(0, endIndex)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (content.length > 20) {
        return cleanAndFormatText(content)
      }
    }

    return ''
  } catch (error) {
    console.warn('改进锚点提取出错:', error)
    return ''
  }
}

/**
 * 使用正则表达式提取锚点内容（备选方案）
 */
export function extractContentByAnchorRegex(htmlContent: string, anchor: string): string {
  try {
    // 策略1：查找带有id的标签
    const idMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${anchor}["'][^>]*>(.*?)</[^>]*>`, 'is'))
    if (idMatch) {
      const content = idMatch[1].replace(/<[^>]*>/g, ' ').trim()
      if (content.length > 20) {
        return cleanAndFormatText(content)
      }
    }

    // 策略2：查找带有name的标签
    const nameMatch = htmlContent.match(new RegExp(`<[^>]*name=["']${anchor}["'][^>]*>(.*?)</[^>]*>`, 'is'))
    if (nameMatch) {
      const content = nameMatch[1].replace(/<[^>]*>/g, ' ').trim()
      if (content.length > 20) {
        return cleanAndFormatText(content)
      }
    }

    // 策略3：查找包含锚点文本的标题
    const titleMatch = htmlContent.match(new RegExp(`<h[1-6][^>]*id=["'][^"']*${anchor}[^"']*["'][^>]*>(.*?)</h[1-6]>`, 'is'))
    if (titleMatch) {
      const title = titleMatch[1].replace(/<[^>]*>/g, '').trim()
      return cleanAndFormatText(title)
    }

    return ''
  } catch (error) {
    console.warn('正则表达式锚点提取失败:', error)
    return ''
  }
}
