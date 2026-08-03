import { describe, it, expect, beforeAll } from 'vitest'
import { EpubProcessor } from '../../src/services/epubProcessor'
import * as fs from 'fs'
import * as path from 'path'

// 使用真实的 EPUB 文件进行测试
const EPUB_PATH = path.join(__dirname, '..', '..', 'tmp', 'epub', '美孚石油公司史.epub')

/**
 * 将 Node Buffer 转为独立 ArrayBuffer。
 * 直接使用 buffer.buffer 可能带有 byteOffset/池化底层缓冲，导致 JSZip 报
 * "Can't read the data of 'the loaded zip file'"。
 */
function toStandaloneArrayBuffer(nodeBuffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(nodeBuffer.byteLength)
  new Uint8Array(copy).set(nodeBuffer)
  return copy
}

describe('EpubProcessor with real book', () => {
  let processor: EpubProcessor
  let file: File

  beforeAll(() => {
    if (!fs.existsSync(EPUB_PATH)) {
      throw new Error(`真实 EPUB 夹具不存在: ${EPUB_PATH}`)
    }

    processor = new EpubProcessor()

    const nodeBuffer = fs.readFileSync(EPUB_PATH)
    const arrayBuffer = toStandaloneArrayBuffer(nodeBuffer)

    // 轻量 File 替身：parseEpub 仅依赖 name/size/lastModified/arrayBuffer
    file = {
      name: '美孚石油公司史.epub',
      size: nodeBuffer.byteLength,
      type: 'application/epub+zip',
      lastModified: Date.now(),
      arrayBuffer: async () => arrayBuffer.slice(0),
    } as File
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

    bookData.chapters.forEach((ch, idx) => {
      console.log(`[${idx + 1}] ${ch.title} - 内容长度: ${ch.content.length}`)
    })

    // 期望至少有较多正文/目录章节
    expect(bookData.chapters.length).toBeGreaterThan(10)
    expect(bookData.title).toBeTruthy()

    const shortChapters = bookData.chapters.filter(ch => ch.content.length < 100)
    console.log('内容少于100字符的章节数:', shortChapters.length)
  }, 120_000)

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
  }, 120_000)
})
