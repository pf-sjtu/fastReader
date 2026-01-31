import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EpubProcessor, type ChapterData } from '../../src/services/epubProcessor'

describe('EpubProcessor', () => {
  let processor: EpubProcessor

  beforeEach(() => {
    processor = new EpubProcessor()
  })

  describe('formatChapterNumber', () => {
    it('should format single digit with padding', () => {
      const result = (processor as any).formatChapterNumber(1, 10)
      expect(result).toBe('01')
    })

    it('should format double digit without padding', () => {
      const result = (processor as any).formatChapterNumber(10, 10)
      expect(result).toBe('10')
    })

    it('should use 3 digits for large chapter counts', () => {
      const result = (processor as any).formatChapterNumber(1, 100)
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
      try { await promise1 } catch {}
    })
  })

  describe('shouldSkipChapter', () => {
    it('should skip chapter with keywords', () => {
      const result = (processor as any).shouldSkipChapter('Preface')
      expect(result).toBe(true)
    })

    it('should not skip normal chapter', () => {
      const result = (processor as any).shouldSkipChapter('Chapter 1: Introduction')
      expect(result).toBe(false)
    })
  })
})
