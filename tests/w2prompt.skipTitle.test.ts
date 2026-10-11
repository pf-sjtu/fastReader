/**
 * 章节跳过词：前端「前缀 + 整词」匹配，与 CLI 共用 tests/fixtures/chapter-skip-cases.json
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  matchesDefaultUnselectTitle,
  matchesSkipChapterTitle,
  SKIP_CHAPTER_KEYWORDS,
} from '../src/services/constants'

interface SkipCase { title: string; skip: boolean; unselect: boolean }
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/chapter-skip-cases.json'), 'utf-8')
) as { cases: SkipCase[] }

describe('chapter-skip-cases.json（跨端共享）', () => {
  it.each(fixture.cases)('$title → skip=$skip unselect=$unselect', ({ title, skip, unselect }) => {
    expect(matchesSkipChapterTitle(title)).toBe(skip)
    expect(matchesDefaultUnselectTitle(title)).toBe(unselect)
  })

  it('正反两类用例都有覆盖', () => {
    expect(fixture.cases.filter((c) => c.skip).length).toBeGreaterThan(10)
    expect(fixture.cases.filter((c) => !c.skip).length).toBeGreaterThan(10)
  })

  it('前端词表与 CLI 词表一致', () => {
    const py = readFileSync(resolve(__dirname, '../src/cli/chapter_extractor.py'), 'utf-8')
    const block = py.slice(py.indexOf('SKIP_CHAPTER_KEYWORDS = ['), py.indexOf(']', py.indexOf('SKIP_CHAPTER_KEYWORDS = [')))
    const cliKeywords = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(cliKeywords).toEqual(SKIP_CHAPTER_KEYWORDS)
  })
})
