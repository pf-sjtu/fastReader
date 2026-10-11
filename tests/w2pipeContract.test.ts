/**
 * 跨端契约：前端 formatUnifiedMarkdown 与 tests/fixtures/contract/unified-summary.sample.md 逐字一致，
 * 且前端解析器能完整解析样例（Python CLI 侧由 tests/python/test_cli_contract.py 比对同一份样例）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { ProcessingMetadata } from '../src/services/cloudCacheService'
import {
  formatUnifiedMarkdown,
  parseMetadataFromContent,
  parseUnifiedMarkdown,
} from '../src/services/metadataFormatter'

const raw = readFileSync(resolve(__dirname, 'fixtures/contract/unified-summary.sample.md'), 'utf-8')
// 第 1 行是用途注释
const sample = raw.slice(raw.indexOf('\n') + 1)

const metadata: ProcessingMetadata = {
  source: 'WebDAV',
  fileName: '示例之书.epub',
  processedAt: '2026-10-11T08:00:00.000Z',
  model: 'gemini-1.5-flash',
  chapterDetectionMode: 'normal',
  epubTocDepth: undefined,
  selectedChapters: '1,2',
  selectedChapterCount: 2,
  chapterCount: 2,
  originalCharCount: 12000,
  processedCharCount: 156,
  inputTokens: 10000,
  outputTokens: 2000,
  costUSD: 0.003,
  costRMB: 0.021,
  skippedChapters: 0,
  isPartial: false,
}

const data = {
  title: '示例之书',
  author: '张三',
  overallSummary: '本书以两段旅程为线索，讨论了出发的勇气与抵达的意义。\n\n全书结构清晰，适合初次接触该主题的读者。',
  connections: '第一章提出问题，第二章给出回应；两章在「选择」这一主题上前后呼应。',
  chapters: [
    { id: 'chapter-1', title: '第一章 起点', summary: '主人公在小镇上做出离开的决定。\n\n本章交代了人物动机与时代背景。' },
    { id: 'chapter-2', title: '第二章 远方', summary: '主人公抵达海边城市，重新理解了故乡。' },
  ],
}

describe('跨端契约：统一摘要 MD', () => {
  it('样例为 LF 行尾，第 2 行起即 formatUnifiedMarkdown 输出原文', () => {
    expect(raw.includes('\r')).toBe(false)
    expect(raw.split('\n')[0].startsWith('<!--')).toBe(true)
    expect(formatUnifiedMarkdown(data, metadata, 'auto')).toBe(sample)
  })

  it('元数据键集合与顺序一致', () => {
    const keysOf = (text: string) =>
      text
        .slice(text.indexOf('<!--\n') + 5, text.indexOf('\n-->'))
        .split('\n')
        .map((line) => line.slice(0, line.indexOf(':')))
    expect(keysOf(formatUnifiedMarkdown(data, metadata))).toEqual(keysOf(sample))
  })

  it('标题层级与分节顺序一致', () => {
    const headings = (text: string) => text.split('\n').filter((l) => /^#{1,3} /.test(l))
    expect(headings(sample)).toEqual([
      '# 示例之书',
      '## 全书总结',
      '## 章节关联分析',
      '## 章节摘要',
      '### 第一章 起点',
      '### 第二章 远方',
    ])
    expect(headings(formatUnifiedMarkdown(data, metadata))).toEqual(headings(sample))
  })

  it('前端解析器完整解析样例（含首行用途注释时不误当元数据）', () => {
    const parsed = parseUnifiedMarkdown(sample)
    expect(parsed.metadata).toEqual({ ...metadata, epubTocDepth: undefined })
    expect(parsed.data).toMatchObject({
      title: data.title,
      author: data.author,
      overallSummary: data.overallSummary,
      connections: data.connections,
      charts: null,
    })
    expect(parsed.data.chapters).toEqual(data.chapters)
    // 带首行用途注释的原文件：首个注释块不是 `<!--\n` 开头，不应被解析为元数据
    expect(parseMetadataFromContent(raw)).toBeNull()
  })
})
