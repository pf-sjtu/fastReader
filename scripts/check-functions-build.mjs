// 用 esbuild 把 functions/ 下每个入口按 Pages 的方式打包一遍。
// 单测是直接 import 模块的，绕过了打包器的解析；`../../_lib/` 这类相对路径错误只有在
// wrangler 构建时才会暴露（曾导致本地 pages dev 起不来）。CI 里跑它，构建失败比部署失败好。
import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = 'functions'
const entries = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '_lib') continue // 被入口引用，不单独成入口
      walk(full)
    } else if (name.endsWith('.js')) {
      entries.push(full)
    }
  }
}
walk(root)

let failed = 0
for (const entry of entries) {
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      logLevel: 'silent',
    })
  } catch (error) {
    failed++
    console.error(`❌ ${relative('.', entry)}`)
    for (const e of error.errors ?? []) console.error(`   ${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`)
  }
}

if (failed) {
  console.error(`\n${failed}/${entries.length} 个 Functions 入口打包失败`)
  process.exit(1)
}
console.log(`✅ ${entries.length} 个 Functions 入口打包通过`)
