// 构建产物体检：入口静态依赖图里出现 chunk 循环依赖即失败（线上会因 TDZ 白屏）。
// 用法：pnpm build:pages && node scripts/check-chunk-cycles.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist/assets'
const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
const graph = new Map(
  files.map((f) => {
    const src = readFileSync(join(dir, f), 'utf8')
    // 仅静态 import/export-from（动态 import(...) 不参与初始化顺序）
    const deps = [...src.matchAll(/(?:import|export)\s*(?:\{[^}]*\}|\*(?:\s*as\s+\w+)?)?\s*from\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1])
    return [f, [...new Set(deps)].filter((d) => files.includes(d))]
  })
)

const state = new Map()
const stack = []
const cycles = []
function visit(n) {
  state.set(n, 1)
  stack.push(n)
  for (const d of graph.get(n) ?? []) {
    if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d])
    else if (!state.has(d)) visit(d)
  }
  stack.pop()
  state.set(n, 2)
}
for (const f of files) if (!state.has(f)) visit(f)

if (cycles.length) {
  console.error('❌ 发现 chunk 循环依赖：')
  for (const c of cycles) console.error('  ' + c.join(' → '))
  process.exit(1)
}
console.log(`✅ ${files.length} 个 chunk 无静态循环依赖`)
