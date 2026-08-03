import { describe, it, expect, beforeAll } from 'vitest'
import { EpubProcessor } from '../../src/services/epubProcessor'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 真实书烟测：《原始码：成为比尔．盖兹》
 * TOC 只指向章名页，正文在下一 spine 文件 —— 验证 epub-toc spine 区间聚合。
 */
const EPUB_PATH = path.join(__dirname, '..', '..', 'tmp', 'epub', 'source-code-bill-gates.epub')

function toStandaloneArrayBuffer(nodeBuffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(nodeBuffer.byteLength)
  new Uint8Array(copy).set(nodeBuffer)
  return copy
}

const hasFixture = fs.existsSync(EPUB_PATH)

describe.skipIf(!hasFixture)('EpubProcessor bill gates realbook (epub-toc spine range)', () => {
  let processor: EpubProcessor
  let file: File

  beforeAll(() => {
    processor = new EpubProcessor()
    const nodeBuffer = fs.readFileSync(EPUB_PATH)
    const arrayBuffer = toStandaloneArrayBuffer(nodeBuffer)

    file = {
      name: 'source-code-bill-gates.epub',
      size: nodeBuffer.byteLength,
      type: 'application/epub+zip',
      lastModified: Date.now(),
      arrayBuffer: async () => arrayBuffer.slice(0),
    } as File
  })

  it('epub-toc 应提取含正文的正文章节（扉页+正文合并）', async () => {
    const bookData = await processor.extractBookData(
      file,
      false,
      true, // skip 封面/版权等（英文关键词）
      0,
      'auto',
      'epub-toc',
      1
    )

    console.log('title:', bookData.title)
    console.log('chapters:', bookData.chapters.length)
    bookData.chapters.forEach((ch, idx) => {
      console.log(`[${idx + 1}] ${ch.title} len=${ch.content.length}`)
    })

    expect(bookData.title).toBeTruthy()
    // 至少应有 14 个编号章 + 序言等
    expect(bookData.chapters.length).toBeGreaterThanOrEqual(14)

    const ch1 = bookData.chapters.find((c) => /第一章/.test(c.title))
    expect(ch1, '应找到第一章').toBeTruthy()
    expect(ch1!.content.length).toBeGreaterThan(1000)
    expect(ch1!.content).toMatch(/玩牌高手|特雷/)

    const ch14 = bookData.chapters.find((c) => /第十四章|第14章/.test(c.title))
    expect(ch14, '应找到第十四章').toBeTruthy()
    expect(ch14!.content.length).toBeGreaterThan(1000)
    expect(ch14!.content).toMatch(/真正的公司|原始码|Micro-Soft|微软|软体/)
  }, 180_000)
})
