import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Book, NavItem } from '@ssshooter/epubjs'
import { EpubProcessor } from '../../src/services/epubProcessor'
import { formatChapterNumber } from '../../src/services/epub'

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
    // Mock book factory for epub-toc tests
    const createMockBook = () => ({
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
        spineItems: [
          { idref: 's1', href: 'chapter1.xhtml' },
          { idref: 's2', href: 'chapter1-1.xhtml' },
          { idref: 's3', href: 'chapter1-1-1.xhtml' },
          { idref: 's4', href: 'chapter1-2.xhtml' },
          { idref: 's5', href: 'chapter2.xhtml' },
          { idref: 's6', href: 'chapter2-1.xhtml' }
        ],
        get: vi.fn().mockReturnValue({
          render: vi.fn().mockResolvedValue('<html><body><p>Content</p></body></html>'),
          unload: vi.fn()
        })
      },
      load: vi.fn().mockResolvedValue({}),
      packaging: { metadata: { title: 'Test Book', creator: 'Test Author' } }
    })

    it('should extract only depth=0 chapters when epubTocDepth=1', async () => {
      const mockBook = createMockBook()

      // Mock getSingleChapterContent to return sufficient content (>100 chars)
      vi.spyOn(processorInternals, 'getSingleChapterContent')
        .mockResolvedValue('This is chapter content with sufficient length to pass the 100 character minimum threshold for valid chapter content. It includes detailed information about the chapter.')

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

      // Mock getSingleChapterContent to return sufficient content (>100 chars)
      vi.spyOn(processorInternals, 'getSingleChapterContent')
        .mockResolvedValue('This is chapter content with sufficient length to pass the 100 character minimum threshold for valid chapter content. It includes detailed information about the chapter.')

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

      // Mock getSingleChapterContent to return sufficient content (>100 chars)
      vi.spyOn(processorInternals, 'getSingleChapterContent')
        .mockResolvedValue('This is chapter content with sufficient length to pass the 100 character minimum threshold for valid chapter content. It includes detailed information about the chapter.')

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

      // Mock getSingleChapterContent to return sufficient content (>100 chars)
      vi.spyOn(processorInternals, 'getSingleChapterContent')
        .mockResolvedValue('This is chapter content with sufficient length to pass the 100 character minimum threshold for valid chapter content. It includes detailed information about the chapter.')

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

    it('should not include subitem content in exact level mode', async () => {
      const mockBook = createMockBook()

      // Mock getSingleChapterContent to track subitem usage
      const getSingleChapterContentSpy = vi.spyOn(processorInternals, 'getSingleChapterContent')
        .mockResolvedValue('Direct chapter content')

      await processor.extractChapters(
        mockBook as Book,
        false,
        false,
        0,
        'auto',
        'epub-toc',
        1
      )

      // In epub-toc mode, should not call getSingleChapterContent for subitems
      // The first call is for the main chapter, subsequent calls would be for subitems
      // With exact level filtering, only main chapters are processed
      expect(getSingleChapterContentSpy).toHaveBeenCalledTimes(2) // Only 2 main chapters

      getSingleChapterContentSpy.mockRestore()
    })
  })
})
