/**
 * 纯文本切章：与 CLI 共读契约夹具 `tests/fixtures/plain-text-cases.json`，
 * 保证前端 `splitPlainText` 与 CLI `src/cli/plain_text.py` 的 `split_plain_text` 同语义。
 * 另一侧：tests/python/test_cli_plain_text.py（同一份夹具、同一批用例名）
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitPlainText } from '../src/services/pipeline/plainText'

interface PlainTextCase {
  name: string
  content: string
  fallbackTitle: string
  expected: { index: number; title: string; content: string }[]
}

const cases = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/plain-text-cases.json'), 'utf8')
) as PlainTextCase[]

describe('共享契约 plain-text-cases.json（前端 ↔ CLI 同语义）', () => {
  it('夹具非空、用例名不重复、index 从 0 连续', () => {
    expect(cases.length).toBeGreaterThan(0)
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
    for (const c of cases) {
      expect(c.expected.map((e) => e.index)).toEqual(c.expected.map((_, i) => i))
    }
  })

  for (const c of cases) {
    it(`切章：${c.name}`, () => {
      const chapters = splitPlainText(c.content, c.fallbackTitle)
      // 夹具的 index 是 0 起的位置下标（CLI 的 Chapter.index 同口径）
      expect(chapters.map((chapter, index) => ({ index, title: chapter.title, content: chapter.content })))
        .toEqual(c.expected)
      // 前端自身的 id 是 1 起的字符串序号，顺带钉住它不漂移
      expect(chapters.map((chapter) => chapter.id)).toEqual(chapters.map((_, i) => String(i + 1)))
    })
  }
})
