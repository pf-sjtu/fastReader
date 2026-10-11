/**
 * 跨端契约（长期保留，默认跳过）：Python CLI 真实产出的「完整摘要.md」必须能被前端云端缓存解析读回。
 * 运行：E2E_CLI_OUTPUT=<CLI 产出的 *-完整摘要.md> pnpm exec vitest run tests/tour/cliOutputContract.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildCloudBook } from '../../src/services/pipeline/cloudLoad'
import { isUsableText } from '../../src/utils/resultStatus'

const FILE = process.env.E2E_CLI_OUTPUT
const live = describe.skipIf(!FILE)

live('CLI 产物 → 前端云端缓存解析', () => {
  it('章节、全书总结、关联分析与元数据都能读回，且不判为部分结果', async () => {
    const content = readFileSync(FILE as string, 'utf8')
    const book = await buildCloudBook(
      { content, metadata: null, chartsJson: null, chartsFileFound: false } as never,
      { fileName: 'tiny-book.epub', fallbackTitle: 'fallback', idPrefix: 'cli' }
    )
    expect(book).not.toBeNull()
    expect(book!.summary.title).toBe('联调小书')
    expect(book!.chapterCount).toBeGreaterThanOrEqual(2)
    expect(book!.summary.chapters.map((c) => c.title)).toEqual(expect.arrayContaining(['光合作用', '市场经济']))
    expect(book!.summary.chapters.every((c) => isUsableText(c.summary))).toBe(true)
    expect(isUsableText(book!.summary.overallSummary)).toBe(true)
    expect(isUsableText(book!.summary.connections)).toBe(true)
    expect(book!.partial).toBe(false)
    expect(book!.metadata?.model).toBe('deepseek-v4-flash')
  })
})
