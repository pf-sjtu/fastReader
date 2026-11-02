/**
 * 评测产物的 mermaid 块用**真解析器**复检。
 *
 * CLI 侧的 `diagnose_block` 对 mermaid 只做结构启发式（首个有效行是不是已知图类型），
 * 所以「坏块 0」这种结论要在这里复核一次才站得住。用法：
 *
 *   uv run --no-sync python tests/tour/eval_rich_guide.py --runs 2 --out .tmp/eval-rich
 *   EVAL_MERMAID_JSON=.tmp/eval-rich/mermaid.json pnpm exec vitest run tests/tour/evalMermaid.test.ts
 *
 * 没给环境变量就跳过（CI 里不该因为缺评测产物而红）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { validateMermaid } from '@/lib/mermaidRender'

interface Row { title: string; run: number; guide: boolean; code: string }

const file = process.env.EVAL_MERMAID_JSON
const rows: Row[] = file ? JSON.parse(readFileSync(resolve(file), 'utf8')) : []

describe.skipIf(!file)('评测产物的 mermaid 块（真实解析器）', () => {
  it('至少有一个块可检查（否则这次复检没意义）', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  it('每个块都能被生产同款解析器解析', async () => {
    const bad: string[] = []
    for (const r of rows) {
      const err = await validateMermaid(r.code)
      if (err) bad.push(`${r.title} run=${r.run} guide=${r.guide}: ${err}\n${r.code}`)
    }
    expect(bad, `真解析器拒绝的块：\n${bad.join('\n---\n')}`).toEqual([])
  })
})
