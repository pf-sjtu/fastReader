/**
 * 更新 src/buildInfo.ts 中的 BUILD_VERSION。
 * 格式：YYYYMMDD.bN
 * - 日期：本地日历日
 * - 同日多次调用：N + 1；跨日：重置为 b1
 *
 * 用法：node scripts/bump-build.mjs
 *       node scripts/bump-build.mjs --dry-run
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const buildInfoPath = path.join(root, 'src', 'buildInfo.ts')

const dryRun = process.argv.includes('--dry-run')

function localYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function parseVersion(content) {
  const m = content.match(/BUILD_VERSION\s*=\s*['"](\d{8})\.b(\d+)['"]/)
  if (!m) return null
  return { date: m[1], n: parseInt(m[2], 10) }
}

function nextVersion(current) {
  const today = localYmd()
  if (current && current.date === today && Number.isFinite(current.n) && current.n > 0) {
    return `${today}.b${current.n + 1}`
  }
  return `${today}.b1`
}

function writeBuildInfo(version) {
  const content = `/**
 * 构建号：YYYYMMDD.bN
 * 由 scripts/bump-build.mjs 在 git commit 前自动更新（同日递增 .bN，跨日重置 .b1）
 */
export const BUILD_VERSION = '${version}'
`
  fs.writeFileSync(buildInfoPath, content, 'utf8')
}

function main() {
  let current = null
  if (fs.existsSync(buildInfoPath)) {
    current = parseVersion(fs.readFileSync(buildInfoPath, 'utf8'))
  }

  const version = nextVersion(current)

  if (dryRun) {
    console.log(`[bump-build] dry-run → ${version}`)
    return
  }

  writeBuildInfo(version)
  console.log(`[bump-build] ${version}`)
}

main()
