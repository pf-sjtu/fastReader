/**
 * 纯文本：与 CLI 共读契约夹具，保证前端与 `src/cli/plain_text.py` 同语义。
 * - `plain-text-cases.json`：切章（`splitPlainText` ↔ `split_plain_text`）
 * - `plain-decode-cases.json`：字节 → 文本（`decodePlainText` ↔ `read_plain_text`）
 * - `plain-title-cases.json`：书名提取（`plainBookTitle` ↔ `plain_book_title`）
 * 另一侧：tests/python/test_cli_plain_text.py（同一批夹具、同一批用例名）
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodePlainText, plainBookTitle, splitPlainText } from '../src/services/pipeline/plainText'

interface PlainTextCase {
  name: string
  content: string
  fallbackTitle: string
  expected: { index: number; title: string; content: string }[]
}

interface DecodeCase {
  name: string
  bytes: number[]
  expected: string
}

interface TitleCase {
  name: string
  input: string
  expected: string
}

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, `fixtures/${file}`), 'utf8')) as T

const cases = read<PlainTextCase[]>('plain-text-cases.json')
const decodeCases = read<DecodeCase[]>('plain-decode-cases.json')
const titleCases = read<TitleCase[]>('plain-title-cases.json')

const expectUniqueNames = (list: { name: string }[]) => {
  expect(list.length).toBeGreaterThan(0)
  expect(new Set(list.map((c) => c.name)).size).toBe(list.length)
}

describe('共享契约 plain-text-cases.json（前端 ↔ CLI 同语义）', () => {
  it('夹具非空、用例名不重复、index 从 0 连续', () => {
    expectUniqueNames(cases)
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

describe('共享契约 plain-decode-cases.json（同一份字节两端同判）', () => {
  it('夹具非空、用例名不重复', () => {
    expectUniqueNames(decodeCases)
  })

  for (const c of decodeCases) {
    it(`解码：${c.name}`, () => {
      expect(decodePlainText(new Uint8Array(c.bytes))).toBe(c.expected)
    })
  }
})

describe('共享契约 plain-title-cases.json（书名提取同语义）', () => {
  it('夹具非空、用例名不重复', () => {
    expectUniqueNames(titleCases)
  })

  for (const c of titleCases) {
    it(`书名：${c.name}`, () => {
      expect(plainBookTitle(c.input)).toBe(c.expected)
    })
  }
})
