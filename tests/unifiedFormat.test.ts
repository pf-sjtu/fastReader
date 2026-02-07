/**
 * 统一格式测试
 * 测试新的 Markdown 统一格式是否正确生成和解析
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  formatUnifiedMarkdown,
  parseUnifiedMarkdown,
  generateMetadata,
  formatAsHTMLComment,
  parseMetadataFromContent,
  type UnifiedBookSummaryData,
  type ProcessResultInfo
} from '../src/services/metadataFormatter'

import { cloudCacheService } from '../src/services/cloudCacheService'

// 测试数据
const testBookData: UnifiedBookSummaryData = {
  title: '测试书籍',
  author: '测试作者',
  chapters: [
    { id: '1', title: '第一章：开始', summary: '这是第一章的总结内容' },
    { id: '2', title: '第二章：发展', summary: '这是第二章的总结内容' },
    { id: '3', title: '第三章：结局', summary: '这是第三章的总结内容' }
  ],
  overallSummary: '这是全书的总结',
  connections: '各章节之间的关联分析内容'
}

const testMetadataInput: ProcessResultInfo = {
  fileName: 'test-book.epub',
  bookTitle: '测试书籍',
  model: 'gemini-1.5-pro',
  chapterDetectionMode: 'smart',
  selectedChapters: [1, 2, 3],
  selectedChapterCount: 3,
  chapterCount: 3,
  originalCharCount: 10000,
  processedCharCount: 5000,
  skippedChapters: 0,
  isPartial: false,
  aiResponseInfo: {
    inputTokens: 1000,
    outputTokens: 500
  }
}

describe('统一格式 Markdown 测试', () => {
  let metadata: ReturnType<typeof generateMetadata>

  beforeEach(() => {
    metadata = generateMetadata(testMetadataInput)
  })

  describe('formatUnifiedMarkdown', () => {
    it('应该生成正确的 HTML 注释元数据', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      
      // 验证 HTML 注释格式
      expect(result).toMatch(/^<!--\n/)
      expect(result).toMatch(/\n-->\n\n/)
      
      // 验证元数据字段
      expect(result).toContain('source: WebDAV')
      expect(result).toContain('fileName: test-book.epub')
      expect(result).toContain('model: gemini-1.5-pro')
      expect(result).toContain('chapterCount: 3')
    })

    it('书名应该使用一级标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      
      // 在元数据之后应该有书名
      expect(result).toMatch(/-->\n\n# 测试书籍\n/)
    })

    it('应该包含作者信息', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      expect(result).toContain('**作者**: 测试作者')
    })

    it('全书总结应该使用二级标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      expect(result).toContain('## 全书总结')
      expect(result).toContain('这是全书的总结')
    })

    it('章节关联应该使用二级标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      expect(result).toContain('## 章节关联分析')
      expect(result).toContain('各章节之间的关联分析内容')
    })

    it('章节摘要应该使用二级标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      expect(result).toContain('## 章节摘要')
    })

    it('各章节应该使用三级标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      expect(result).toContain('### 第一章：开始')
      expect(result).toContain('### 第二章：发展')
      expect(result).toContain('### 第三章：结局')
    })

    it('number 命名模式应该生成章节号标题', () => {
      const result = formatUnifiedMarkdown(testBookData, metadata, 'numbered')
      expect(result).toContain('### 第01章')
      expect(result).toContain('### 第02章')
      expect(result).toContain('### 第03章')
    })

    it('应该正确处理没有作者的情况', () => {
      const bookDataWithoutAuthor = { ...testBookData, author: undefined }
      const result = formatUnifiedMarkdown(bookDataWithoutAuthor, metadata, 'auto')
      
      // 不应包含作者信息行
      expect(result).not.toMatch(/\*\*作者\*\*:/)
    })

    it('应该正确处理没有全书总结的情况', () => {
      const bookDataWithoutSummary = { ...testBookData, overallSummary: undefined }
      const result = formatUnifiedMarkdown(bookDataWithoutSummary, metadata, 'auto')
      
      // 不应包含全书总结部分
      expect(result).not.toContain('## 全书总结')
    })

    it('应该正确处理没有章节关联的情况', () => {
      const bookDataWithoutConnections = { ...testBookData, connections: undefined }
      const result = formatUnifiedMarkdown(bookDataWithoutConnections, metadata, 'auto')
      
      // 不应包含章节关联部分
      expect(result).not.toContain('## 章节关联分析')
    })

    it('应该正确处理空章节列表', () => {
      const bookDataWithoutChapters = { ...testBookData, chapters: [] }
      const result = formatUnifiedMarkdown(bookDataWithoutChapters, metadata, 'auto')
      
      // 不应包含章节摘要部分
      expect(result).not.toContain('## 章节摘要')
    })
  })

  describe('parseUnifiedMarkdown', () => {
    it('应该正确解析生成的 Markdown', () => {
      const markdown = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      const parsed = parseUnifiedMarkdown(markdown)

      // 验证元数据
      expect(parsed.metadata).not.toBeNull()
      expect(parsed.metadata?.fileName).toBe('test-book.epub')
      expect(parsed.metadata?.model).toBe('gemini-1.5-pro')
      expect(parsed.metadata?.chapterCount).toBe(3)

      // 验证书籍数据
      expect(parsed.data.title).toBe('测试书籍')
      expect(parsed.data.author).toBe('测试作者')
      expect(parsed.data.overallSummary).toBe('这是全书的总结')
      expect(parsed.data.connections).toBe('各章节之间的关联分析内容')
      expect(parsed.data.chapters).toHaveLength(3)
      expect(parsed.data.chapters[0].title).toBe('第一章：开始')
      expect(parsed.data.chapters[0].summary).toBe('这是第一章的总结内容')
    })

    it('应该正确处理没有元数据的 Markdown', () => {
      const markdownWithoutMetadata = `# 测试书籍

**作者**: 测试作者

## 全书总结

这是全书的总结

## 章节摘要

### 第一章

这是第一章总结
`
      const parsed = parseUnifiedMarkdown(markdownWithoutMetadata)

      expect(parsed.metadata).toBeNull()
      expect(parsed.data.title).toBe('测试书籍')
      expect(parsed.data.author).toBe('测试作者')
    })

    it('应该正确处理只有基本内容的 Markdown', () => {
      const simpleMarkdown = `# 简单书籍

## 章节摘要

### 第一章

第一章内容
`
      const parsed = parseUnifiedMarkdown(simpleMarkdown)

      expect(parsed.data.title).toBe('简单书籍')
      expect(parsed.data.author).toBe('')
      expect(parsed.data.chapters).toHaveLength(1)
      expect(parsed.data.chapters[0].title).toBe('第一章')
    })
  })

  describe('cloudCacheService.parseUnifiedContent', () => {
    it('应该正确解析统一格式内容', () => {
      const markdown = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      const parsed = cloudCacheService.parseUnifiedContent(markdown)

      expect(parsed.metadata).not.toBeNull()
      expect(parsed.title).toBe('测试书籍')
      expect(parsed.author).toBe('测试作者')
      expect(parsed.overallSummary).toBe('这是全书的总结')
      expect(parsed.connections).toBe('各章节之间的关联分析内容')
      expect(parsed.chapters).toHaveLength(3)
    })
  })

  describe('HTML 注释格式验证', () => {
    it('元数据 HTML 注释格式应该符合规范', () => {
      const comment = formatAsHTMLComment(metadata)
      
      // 应该以 <!-- 开头
      expect(comment).toMatch(/^<!--/)
      
      // 应该以 --> 结尾
      expect(comment).toMatch(/-->$/)
      
      // 内部应该包含 key: value 格式的行
      expect(comment).toMatch(/fileName: test-book.epub/)
      expect(comment).toMatch(/chapterCount: 3/)
    })

    it('应该能正确解析 HTML 注释中的元数据', () => {
      const comment = formatAsHTMLComment(metadata)
      const fullMarkdown = `${comment}\n\n# 测试书籍`
      
      const parsed = parseMetadataFromContent(fullMarkdown)
      
      expect(parsed).not.toBeNull()
      expect(parsed?.fileName).toBe('test-book.epub')
      expect(parsed?.chapterCount).toBe(3)
    })
  })

  describe('完整往返测试', () => {
    it('生成后解析应该保持一致', () => {
      // 生成 Markdown
      const markdown = formatUnifiedMarkdown(testBookData, metadata, 'auto')
      
      // 解析
      const parsed = parseUnifiedMarkdown(markdown)
      
      // 验证所有关键字段保持一致
      expect(parsed.data.title).toBe(testBookData.title)
      expect(parsed.data.author).toBe(testBookData.author)
      expect(parsed.data.overallSummary).toBe(testBookData.overallSummary)
      expect(parsed.data.connections).toBe(testBookData.connections)
      expect(parsed.data.chapters).toHaveLength(testBookData.chapters.length)
      
      // 验证每个章节
      parsed.data.chapters.forEach((ch, index) => {
        expect(ch.summary).toBe(testBookData.chapters[index].summary)
      })
      
      // 验证元数据
      expect(parsed.metadata?.fileName).toBe(metadata.fileName)
      expect(parsed.metadata?.chapterCount).toBe(metadata.chapterCount)
    })
  })
})
