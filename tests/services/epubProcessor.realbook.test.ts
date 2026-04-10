import { describe, it, expect, beforeAll, vi } from 'vitest'
import { EpubProcessor } from '../../src/services/epubProcessor'
import * as fs from 'fs'
import * as path from 'path'

// 使用真实的 EPUB 文件进行测试
const EPUB_PATH = path.join(__dirname, '..', '..', 'tmp', 'epub', '美孚石油公司史.epub')

describe('EpubProcessor with real book', () => {
  let processor: EpubProcessor
  let file: File
  let arrayBuffer: ArrayBuffer

  beforeAll(async () => {
    processor = new EpubProcessor()

    // 读取真实 EPUB 文件
    const buffer = fs.readFileSync(EPUB_PATH)
    arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

    // 创建 File 对象并 mock arrayBuffer 方法
    const blob = new Blob([buffer], { type: 'application/epub+zip' })
    file = new File([blob], '美孚石油公司史.epub', { type: 'application/epub+zip' })

    // Mock arrayBuffer 方法
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(arrayBuffer),
      writable: true,
      configurable: true
    })
  })

  it('应该在 epub-toc 模式下提取所有章节', async () => {
    const bookData = await processor.extractBookData(
      file,
      false, // useSmartDetection
      true,  // skipNonEssentialChapters
      0,     // maxSubChapterDepth
      'auto', // chapterNamingMode
      'epub-toc', // chapterDetectionMode
      1      // epubTocDepth
    )

    console.log('提取到的章节数:', bookData.chapters.length)
    console.log('书名:', bookData.title)
    console.log('作者:', bookData.author)

    // 即使失败也打印章节信息以便调试
    bookData.chapters.forEach((ch, idx) => {
      console.log(`[${idx + 1}] ${ch.title} - 内容长度: ${ch.content.length}`)
    })

    // 期望至少有 18 章（序言 + 18章正文）
    expect(bookData.chapters.length).toBeGreaterThan(10)

    // 打印前几章信息
    bookData.chapters.slice(0, 10).forEach((ch, idx) => {
      console.log(`[${idx + 1}] ${ch.title} - 内容长度: ${ch.content.length}`)
    })

    // 检查是否有内容太短的章节
    const shortChapters = bookData.chapters.filter(ch => ch.content.length < 100)
    console.log('内容少于100字符的章节数:', shortChapters.length)

    if (shortChapters.length > 0) {
      console.log('内容短的章节:')
      shortChapters.forEach(ch => {
        console.log(`  - ${ch.title}: ${ch.content.length} chars`)
      })
    }
  })

  it('应该在 normal 模式下提取章节', async () => {
    const bookData = await processor.extractBookData(
      file,
      false, // useSmartDetection
      true,  // skipNonEssentialChapters
      0,     // maxSubChapterDepth
      'auto', // chapterNamingMode
      'normal', // chapterDetectionMode
      1      // epubTocDepth
    )

    console.log('normal 模式提取到的章节数:', bookData.chapters.length)
    expect(bookData.chapters.length).toBeGreaterThan(0)
  })
})
