/**
 * renderPrompt 跨端用例（与 CLI tests/python/test_cli_render_prompt.py 共用 tests/fixtures/prompts/render-cases.json）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
}))

import { renderPrompt, type PromptVar } from '../src/services/prompts/render'

interface RenderCase {
  name: string
  template: string
  vars: string | PromptVar[]
  expected: string
  unknown: string[]
}
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/prompts/render-cases.json'), 'utf-8')
) as Record<string, unknown> & { cases: RenderCase[] }

describe('renderPrompt（render-cases.json）', () => {
  beforeEach(() => warn.mockClear())

  it.each(fixture.cases)('$name', (c) => {
    const vars = typeof c.vars === 'string' ? (fixture[c.vars] as PromptVar[]) : c.vars
    expect(renderPrompt(c.template, vars)).toBe(c.expected)
    if (c.unknown.length > 0) {
      expect(warn).toHaveBeenCalledTimes(1)
      for (const name of c.unknown) expect(String(warn.mock.calls[0][0])).toContain(name)
    } else {
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it('无变量且无占位符时原样返回', () => {
    expect(renderPrompt('原样\n', [])).toBe('原样\n')
  })
})
