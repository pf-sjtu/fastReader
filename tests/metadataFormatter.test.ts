/**
 * 元数据格式化器测试
 */

import { describe, it, expect } from 'vitest'
import {
  generateMetadata,
  formatAsHTMLComment,
  addMetadataToContent,
  parseMetadataFromContent,
  stripMetadataFromContent,
  getModelPricing,
  registerModelPricing,
  type ProcessResultInfo
} from '../src/services/metadataFormatter'
import type { ProcessingMetadata } from '../src/services/cloudCacheService'

describe('MetadataFormatter', () => {
  describe('generateMetadata', () => {
    it('should generate metadata with correct structure', () => {
      const result: ProcessResultInfo = {
        fileName: 'test.epub',
        bookTitle: 'Test Book',
        model: 'gemini-1.5-flash',
        chapterDetectionMode: 'normal',
        selectedChapters: [1, 2, 3],
        chapterCount: 10,
        originalCharCount: 10000,
        processedCharCount: 5000,
        aiResponseInfo: {
          inputTokens: 1000,
          outputTokens: 500
        }
      }

      const metadata = generateMetadata(result)

      expect(metadata.fileName).toBe('test.epub')
      expect(metadata.model).toBe('gemini-1.5-flash')
      expect(metadata.chapterCount).toBe(10)
      expect(metadata.selectedChapters).toBe('1,2,3')
      expect(metadata.costUSD).toBeGreaterThan(0)
      expect(metadata.costRMB).toBeGreaterThan(0)
    })

    it('should handle missing aiResponseInfo', () => {
      const result: ProcessResultInfo = {
        fileName: 'test.epub',
        model: 'gemini-1.5-flash',
        chapterDetectionMode: 'normal',
        selectedChapters: [1],
        chapterCount: 1,
        originalCharCount: 1000,
        processedCharCount: 500
      }

      const metadata = generateMetadata(result)

      expect(metadata.inputTokens).toBe(0)
      expect(metadata.outputTokens).toBe(0)
      expect(metadata.costUSD).toBe(0)
    })
  })

  describe('formatAsHTMLComment', () => {
    it('should format metadata as HTML comment', () => {
      const metadata: ProcessingMetadata = {
        source: 'WebDAV',
        fileName: 'test.epub',
        processedAt: '2024-01-01T00:00:00.000Z',
        model: 'gemini-1.5-flash',
        chapterDetectionMode: 'normal',
        selectedChapters: '1,2,3',
        chapterCount: 10,
        originalCharCount: 10000,
        processedCharCount: 5000,
        inputTokens: 1000,
        outputTokens: 500,
        costUSD: 0.0015,
        costRMB: 0.0105
      }

      const comment = formatAsHTMLComment(metadata)

      expect(comment).toContain('<!--')
      expect(comment).toContain('source: WebDAV')
      expect(comment).toContain('fileName: test.epub')
      expect(comment).toContain('-->')
    })
  })

  describe('addMetadataToContent', () => {
    it('should add metadata comment to content', () => {
      const content = '# Test Book\n\nThis is the content.'
      const metadata: ProcessingMetadata = {
        source: 'WebDAV',
        fileName: 'test.epub',
        processedAt: '2024-01-01T00:00:00.000Z',
        model: 'gemini-1.5-flash',
        chapterDetectionMode: 'normal',
        selectedChapters: '1,2,3',
        chapterCount: 10,
        originalCharCount: 10000,
        processedCharCount: 5000,
        inputTokens: 1000,
        outputTokens: 500,
        costUSD: 0.0015,
        costRMB: 0.0105
      }

      const result = addMetadataToContent(content, metadata)

      expect(result).toContain('<!--')
      expect(result).toContain('# Test Book')
      expect(result).toContain('-->')
      expect(result.indexOf('<!--')).toBe(0)
    })
  })

  describe('parseMetadataFromContent', () => {
    it('should parse metadata from content', () => {
      const contentWithMetadata = `<!--
source: WebDAV
fileName: test.epub
processedAt: 2024-01-01T00:00:00.000Z
model: gemini-1.5-flash
chapterDetectionMode: normal
selectedChapters: 1,2,3
chapterCount: 10
originalCharCount: 10000
processedCharCount: 5000
inputTokens: 1000
outputTokens: 500
costUSD: 0.0015
costRMB: 0.0105 (USD/CNY: 7)
-->

# Test Book

This is the content.`

      const metadata = parseMetadataFromContent(contentWithMetadata)

      expect(metadata).not.toBeNull()
      expect(metadata?.fileName).toBe('test.epub')
      expect(metadata?.model).toBe('gemini-1.5-flash')
      expect(metadata?.chapterCount).toBe(10)
      expect(metadata?.selectedChapters).toBe('1,2,3')
    })

    it('should return null for content without metadata', () => {
      const content = '# Test Book\n\nThis is the content.'

      const metadata = parseMetadataFromContent(content)

      expect(metadata).toBeNull()
    })

    it('should return null for invalid metadata format', () => {
      const content = `<!-- invalid format -->

# Test Book`

      const metadata = parseMetadataFromContent(content)

      expect(metadata).toBeNull()
    })
  })

  describe('stripMetadataFromContent', () => {
    it('should remove metadata comment from content', () => {
      const contentWithMetadata = `<!--
source: WebDAV
fileName: test.epub
-->

# Test Book

This is the content.`

      const stripped = stripMetadataFromContent(contentWithMetadata)

      expect(stripped).toContain('# Test Book')
      expect(stripped).not.toContain('<!--')
      expect(stripped.indexOf('# Test Book')).toBe(0)
    })

    it('should handle content without metadata', () => {
      const content = '# Test Book\n\nThis is the content.'

      const stripped = stripMetadataFromContent(content)

      expect(stripped).toBe(content)
    })
  })

  describe('getModelPricing', () => {
    it('should return pricing for known models', () => {
      const pricing = getModelPricing('gemini-1.5-flash')

      expect(pricing).not.toBeNull()
      expect(pricing?.input).toBe(0.075)
      expect(pricing?.output).toBe(1.125)
    })

    it('should return null for unknown models', () => {
      const pricing = getModelPricing('unknown-model')

      expect(pricing).toBeNull()
    })

    it('should return pricing for OpenAI models', () => {
      const pricing = getModelPricing('gpt-4o')

      expect(pricing).not.toBeNull()
      expect(pricing?.input).toBe(5.0)
      expect(pricing?.output).toBe(15.0)
    })

    it('should return pricing for Ollama models (free)', () => {
      const pricing = getModelPricing('llama3')

      expect(pricing).not.toBeNull()
      expect(pricing?.input).toBe(0)
      expect(pricing?.output).toBe(0)
    })
  })

  describe('registerModelPricing', () => {
    it('should register custom model pricing', () => {
      registerModelPricing('custom-model', 1.0, 2.0)

      const pricing = getModelPricing('custom-model')

      expect(pricing).not.toBeNull()
      expect(pricing?.input).toBe(1.0)
      expect(pricing?.output).toBe(2.0)
    })
  })

  describe('cost calculation', () => {
    it('should calculate cost correctly for Gemini 1.5 Flash', () => {
      const result: ProcessResultInfo = {
        fileName: 'test.epub',
        model: 'gemini-1.5-flash',
        chapterDetectionMode: 'normal',
        selectedChapters: [1],
        chapterCount: 10,
        originalCharCount: 100000,
        processedCharCount: 50000,
        aiResponseInfo: {
          inputTokens: 75000, // Input: 0.075 per 1M tokens = 0.005625 USD
          outputTokens: 10000 // Output: 1.125 per 1M tokens = 0.01125 USD
        }
      }

      const metadata = generateMetadata(result)

      // Expected cost: (0.075/1M * 75000) + (1.125/1M * 10000) = 0.005625 + 0.01125 = 0.016875 USD
      expect(metadata.costUSD).toBeCloseTo(0.016875, 4)
    })

    it('should calculate cost correctly for GPT-4o', () => {
      const result: ProcessResultInfo = {
        fileName: 'test.epub',
        model: 'gpt-4o',
        chapterDetectionMode: 'normal',
        selectedChapters: [1],
        chapterCount: 10,
        originalCharCount: 100000,
        processedCharCount: 50000,
        aiResponseInfo: {
          inputTokens: 100000, // Input: 5.0 per 1M tokens = 0.5 USD
          outputTokens: 20000 // Output: 15.0 per 1M tokens = 0.3 USD
        }
      }

      const metadata = generateMetadata(result)

      // Expected cost: (5.0/1M * 100000) + (15.0/1M * 20000) = 0.5 + 0.3 = 0.8 USD
      expect(metadata.costUSD).toBeCloseTo(0.8, 2)
    })
  })
})
