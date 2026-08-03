/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildSummaryMarkdown,
  getSummaryExportBaseName,
  downloadSummaryMarkdown,
} from '../src/utils/exportSummary'
import type { BookSummary } from '../src/hooks/useBookProcessing'

const sampleSummary: BookSummary = {
  title: '测试之书',
  author: '作者甲',
  connections: '章节之间**相互呼应**。',
  overallSummary: '这是全书总结。\n\n> 一句洞见',
  chapters: [
    {
      id: 'c1',
      title: '第一章 开端',
      content: '原文内容'.repeat(10),
      summary: '第一章摘要，含 *斜体* 与 **加粗**。',
      processed: true,
    },
    {
      id: 'c2',
      title: '第二章',
      content: '',
      summary: '第二章摘要。',
      processed: true,
    },
  ],
}

describe('exportSummary', () => {
  describe('getSummaryExportBaseName', () => {
    it('优先使用文件名去扩展名', () => {
      expect(getSummaryExportBaseName(sampleSummary, 'foo.bar.epub')).toBe('foo.bar')
    })

    it('无文件时回退书名', () => {
      expect(getSummaryExportBaseName(sampleSummary, null)).toBe('测试之书')
      expect(getSummaryExportBaseName(sampleSummary)).toBe('测试之书')
    })

    it('清理非法文件名字符', () => {
      const s = { ...sampleSummary, title: 'a<>:"/\\|?*b' }
      // <>:"/\|?* → 9 个非法字符
      expect(getSummaryExportBaseName(s)).toBe('a_________b')
    })
  })

  describe('buildSummaryMarkdown', () => {
    it('无 file 也能生成完整 Markdown', () => {
      const md = buildSummaryMarkdown({
        bookSummary: sampleSummary,
        model: 'test-model',
        chapterNamingMode: 'auto',
      })
      expect(md).toContain('# 测试之书')
      expect(md).toContain('**作者**: 作者甲')
      expect(md).toContain('## 全书总结')
      expect(md).toContain('## 章节关联分析')
      expect(md).toContain('## 章节摘要')
      expect(md).toContain('### 第一章 开端')
      expect(md).toContain('第一章摘要')
    })

    it('numbered 模式使用第XX章标题', () => {
      const md = buildSummaryMarkdown({
        bookSummary: sampleSummary,
        chapterNamingMode: 'numbered',
        prepareForRender: false,
      })
      expect(md).toContain('### 第01章')
      expect(md).toContain('### 第02章')
    })

    it('包含元数据注释', () => {
      const md = buildSummaryMarkdown({
        bookSummary: sampleSummary,
        fileName: 'book.epub',
        model: 'gemini-1.5-flash',
        prepareForRender: false,
      })
      expect(md).toMatch(/<!--[\s\S]*fileName: book\.epub[\s\S]*-->/)
      expect(md).toContain('model: gemini-1.5-flash')
    })
  })

  describe('downloadSummaryMarkdown', () => {
    const clickMock = vi.fn()
    let createdLink: HTMLAnchorElement | null = null

    beforeEach(() => {
      createdLink = null
      clickMock.mockReset()
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      })
      const originalCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreate(tag)
        if (tag === 'a') {
          createdLink = el as HTMLAnchorElement
          el.click = clickMock
        }
        return el
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('无 file 时也能触发下载', () => {
      const result = downloadSummaryMarkdown({ bookSummary: sampleSummary })
      expect(result.fileName).toBe('测试之书_总结.md')
      expect(clickMock).toHaveBeenCalledTimes(1)
      expect(createdLink?.download).toBe('测试之书_总结.md')
    })
  })
})
