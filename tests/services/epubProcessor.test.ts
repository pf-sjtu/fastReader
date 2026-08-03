import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Book, NavItem } from '@ssshooter/epubjs'
import { EpubProcessor } from '../../src/services/epubProcessor'
import { formatChapterNumber } from '../../src/services/epub'

// 单元测试使用 mock，避免依赖真实 EPUB 解析；realbook 测试不 mock
vi.mock('@ssshooter/epubjs', async () => {
  return await import('../__mocks__/@ssshooter/epubjs')
})

type ProcessorInternals = {
  shouldSkipChapter: (title: string) => boolean
  extractChaptersFromToc: (
    book: Book,
    toc: NavItem[],
    currentDepth: number,
    maxDepth: number,
    chapterNamingMode: 'auto' | 'numbered',
    totalChapters: number,
    preserveAnchors: boolean
  ) => Promise<Array<{ title: string; depth: number }>>
  getSingleChapterContent: (book: Book, href: string, anchor?: string) => Promise<string>
}

// Mock arrayBuffer for File in jsdom
if (typeof File !== 'undefined') {
  File.prototype.arrayBuffer = vi.fn().mockImplementation(function(this: File) {
    // Return arrayBuffer with content matching file size
    return Promise.resolve(new ArrayBuffer(this.size))
  })
}

describe('EpubProcessor', () => {
  let processor: EpubProcessor
  let processorInternals: ProcessorInternals

  beforeEach(() => {
    processor = new EpubProcessor()
    processorInternals = processor as unknown as ProcessorInternals
  })

  describe('formatChapterNumber', () => {
    it('should format single digit with padding', () => {
      const result = formatChapterNumber(1, 10)
      expect(result).toBe('01')
    })

    it('should format double digit without padding', () => {
      const result = formatChapterNumber(10, 10)
      expect(result).toBe('10')
    })

    it('should use 3 digits for large chapter counts', () => {
      const result = formatChapterNumber(1, 100)
      expect(result).toBe('001')
    })
  })

  describe('parseEpub', () => {
    it('should throw error for empty file', async () => {
      const emptyFile = new File([], 'empty.epub')
      await expect(processor.parseEpub(emptyFile)).rejects.toThrow('解析EPUB文件失败')
    })

    it('should prevent duplicate processing', async () => {
      const mockFile = new File(['mock'], 'test.epub')
      
      // First call should start processing
      const promise1 = processor.parseEpub(mockFile)
      
      // Second call should throw
      await expect(processor.parseEpub(mockFile)).rejects.toThrow('文件正在处理中')
      
      // Wait for first to complete (will fail but that's ok)
      await promise1.catch(() => undefined)
    })
  })

  describe('shouldSkipChapter', () => {
    it('should skip chapter with keywords', () => {
      const result = processorInternals.shouldSkipChapter('Preface')
      expect(result).toBe(true)
    })

    it('should not skip normal chapter', () => {
      const result = processorInternals.shouldSkipChapter('Chapter 1: Introduction')
      expect(result).toBe(false)
    })
  })

  describe('extractChaptersFromToc', () => {
    it('should collect chapters with correct depth levels', async () => {
      // Mock TOC structure with 3 levels
      const mockToc = [
        {
          id: 'ch1',
          href: 'chapter1.xhtml',
          label: 'Chapter 1',
          subitems: [
            {
              id: 'ch1-1',
              href: 'chapter1-1.xhtml',
              label: 'Section 1.1',
              subitems: [
                { id: 'ch1-1-1', href: 'chapter1-1-1.xhtml', label: 'Subsection 1.1.1', subitems: [] }
              ]
            },
            { id: 'ch1-2', href: 'chapter1-2.xhtml', label: 'Section 1.2', subitems: [] }
          ]
        },
        {
          id: 'ch2',
          href: 'chapter2.xhtml',
          label: 'Chapter 2',
          subitems: [
            { id: 'ch2-1', href: 'chapter2-1.xhtml', label: 'Section 2.1', subitems: [] }
          ]
        }
      ]

      // Mock book object
      const mockBook = {
        navigation: { toc: mockToc },
        spine: { spineItems: [{ href: 'chapter1.xhtml' }, { href: 'chapter2.xhtml' }] }
      }

      const result = await processorInternals.extractChaptersFromToc(
        mockBook as Book, mockToc as NavItem[], 0, 3, 'auto', 10, false
      )

      // Should collect all chapters with correct depths
      expect(result).toHaveLength(6)
      expect(result[0]).toMatchObject({ title: 'Chapter 1', depth: 0 })
      expect(result[1]).toMatchObject({ title: 'Section 1.1', depth: 1 })
      expect(result[2]).toMatchObject({ title: 'Subsection 1.1.1', depth: 2 })
      expect(result[3]).toMatchObject({ title: 'Section 1.2', depth: 1 })
      expect(result[4]).toMatchObject({ title: 'Chapter 2', depth: 0 })
      expect(result[5]).toMatchObject({ title: 'Section 2.1', depth: 1 })
    })
  })

  describe('epub-toc mode exact level filtering', () => {
    const longBody = (label: string) =>
      `<html><body><p>${label} ${'正文内容段落。'.repeat(20)}</p></body></html>`

    // Mock book factory for epub-toc tests
    const createMockBook = () => {
      const htmlByHref: Record<string, string> = {
        'chapter1.xhtml': longBody('Chapter1'),
        'chapter1-1.xhtml': longBody('Section1.1'),
        'chapter1-1-1.xhtml': longBody('Subsection1.1.1'),
        'chapter1-2.xhtml': longBody('Section1.2'),
        'chapter2.xhtml': longBody('Chapter2'),
        'chapter2-1.xhtml': longBody('Section2.1'),
      }

      const spineItems = [
        { idref: 's1', href: 'chapter1.xhtml' },
        { idref: 's2', href: 'chapter1-1.xhtml' },
        { idref: 's3', href: 'chapter1-1-1.xhtml' },
        { idref: 's4', href: 'chapter1-2.xhtml' },
        { idref: 's5', href: 'chapter2.xhtml' },
        { idref: 's6', href: 'chapter2-1.xhtml' }
      ]

      return {
        navigation: {
          toc: [
            {
              id: 'ch1',
              href: 'chapter1.xhtml',
              label: 'Chapter 1',
              subitems: [
                {
                  id: 'ch1-1',
                  href: 'chapter1-1.xhtml',
                  label: 'Section 1.1',
                  subitems: [
                    { id: 'ch1-1-1', href: 'chapter1-1-1.xhtml', label: 'Subsection 1.1.1', subitems: [] }
                  ]
                },
                { id: 'ch1-2', href: 'chapter1-2.xhtml', label: 'Section 1.2', subitems: [] }
              ]
            },
            {
              id: 'ch2',
              href: 'chapter2.xhtml',
              label: 'Chapter 2',
              subitems: [
                { id: 'ch2-1', href: 'chapter2-1.xhtml', label: 'Section 2.1', subitems: [] }
              ]
            }
          ]
        },
        spine: {
          spineItems,
          get: vi.fn((index: number) => {
            const href = spineItems[index]?.href
            return {
              render: vi.fn().mockResolvedValue(htmlByHref[href] || longBody('fallback')),
              unload: vi.fn()
            }
          })
        },
        load: vi.fn().mockResolvedValue({}),
        packaging: { metadata: { title: 'Test Book', creator: 'Test Author' } }
      }
    }

    it('should extract only depth=0 chapters when epubTocDepth=1', async () => {
      const mockBook = createMockBook()

      const chapters = await processor.extractChapters(
        mockBook as Book,
        false, // useSmartDetection
        false, // skipNonEssentialChapters
        0,     // maxSubChapterDepth
        'auto',// chapterNamingMode
        'epub-toc', // chapterDetectionMode
        1      // epubTocDepth = 1, target depth = 0
      )

      // Should only have level 1 (depth 0) chapters
      expect(chapters.length).toBe(2)
      expect(chapters[0].title).toBe('Chapter 1')
      expect(chapters[0].depth).toBe(0)
      expect(chapters[1].title).toBe('Chapter 2')
      expect(chapters[1].depth).toBe(0)
    })

    it('should extract only depth=1 chapters when epubTocDepth=2', async () => {
      const mockBook = createMockBook()

      const chapters = await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        2 // epubTocDepth = 2, target depth = 1
      )

      // Should only have level 2 (depth 1) chapters
      expect(chapters.length).toBe(3)
      expect(chapters[0].title).toBe('Section 1.1')
      expect(chapters[0].depth).toBe(1)
      expect(chapters[1].title).toBe('Section 1.2')
      expect(chapters[1].depth).toBe(1)
      expect(chapters[2].title).toBe('Section 2.1')
      expect(chapters[2].depth).toBe(1)
    })

    it('should extract only depth=2 chapters when epubTocDepth=3', async () => {
      const mockBook = createMockBook()

      const chapters = await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        3 // epubTocDepth = 3, target depth = 2
      )

      // Should only have level 3 (depth 2) chapters
      expect(chapters.length).toBe(1)
      expect(chapters[0].title).toBe('Subsection 1.1.1')
      expect(chapters[0].depth).toBe(2)
    })

    it('should fallback to spine when target level is empty', async () => {
      const mockBook = createMockBook()

      // Request depth=5 which has no chapters
      const chapters = await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        5 // epubTocDepth = 5, no chapters at depth 4
      )

      // Should fall back to all collected chapters (not filtered)
      // Note: Current implementation keeps all if filtered is empty
      expect(chapters.length).toBeGreaterThan(0)
    })

    it('should aggregate spine range between consecutive TOC entries', async () => {
      const mockBook = createMockBook()

      const chapters = await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        1
      )

      // Chapter 1 区间含 chapter1 + 1-1 + 1-1-1 + 1-2，直到 chapter2
      expect(chapters[0].content).toContain('Chapter1')
      expect(chapters[0].content).toContain('Section1.1')
      expect(chapters[0].content).toContain('Section1.2')
      expect(chapters[0].content).not.toContain('Chapter2')

      // Chapter 2 区间含 chapter2 + 2-1
      expect(chapters[1].content).toContain('Chapter2')
      expect(chapters[1].content).toContain('Section2.1')
    })

    it('should merge title-page + body when TOC only points to short title page', async () => {
      const titleHtml = '<html><body><p>第一章 特雷 从游戏中学会</p></body></html>'
      const bodyHtml = `<html><body><p>玩牌高手 ${'这是正文段落内容。'.repeat(30)}</p></body></html>`
      const nextTitleHtml = '<html><body><p>第二章 维岭 在充满机会的美国</p></body></html>'
      const nextBodyHtml = `<html><body><p>六零年代的西雅图 ${'这是第二章正文。'.repeat(30)}</p></body></html>`

      const spineItems = [
        { idref: 's9', href: 'Text/story-9.xhtml' },
        { idref: 's10', href: 'Text/story-10.xhtml' },
        { idref: 's11', href: 'Text/story-11.xhtml' },
        { idref: 's12', href: 'Text/story-12.xhtml' }
      ]
      const htmlByHref: Record<string, string> = {
        'Text/story-9.xhtml': titleHtml,
        'Text/story-10.xhtml': bodyHtml,
        'Text/story-11.xhtml': nextTitleHtml,
        'Text/story-12.xhtml': nextBodyHtml
      }

      const mockBook = {
        navigation: {
          toc: [
            { id: 'c1', href: 'story-9.xhtml', label: '第一章　特雷', subitems: [] },
            { id: 'c2', href: 'story-11.xhtml', label: '第二章　维岭', subitems: [] }
          ]
        },
        spine: {
          spineItems,
          get: vi.fn((index: number) => {
            const href = spineItems[index]?.href
            return {
              render: vi.fn().mockResolvedValue(htmlByHref[href]),
              unload: vi.fn()
            }
          })
        },
        load: vi.fn().mockResolvedValue({}),
        packaging: { metadata: { title: '原始码', creator: 'Bill Gates' } }
      }

      const chapters = await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        1
      )

      expect(chapters.length).toBe(2)
      expect(chapters[0].title).toContain('第一章')
      expect(chapters[0].content).toContain('玩牌高手')
      expect(chapters[0].content.length).toBeGreaterThan(100)
      // 单读扉页会 <100 被丢弃；区间聚合后应保留
      expect(chapters[1].title).toContain('第二章')
      expect(chapters[1].content).toContain('六零年代的西雅图')
    })
  })
})
