/**
 * 将 core.hooksPath 指向仓库内 scripts/git-hooks
 * 用法：node scripts/install-git-hooks.mjs
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const hooksDir = path.join(root, 'scripts', 'git-hooks')
const preCommit = path.join(hooksDir, 'pre-commit')

function main() {
  if (!fs.existsSync(preCommit)) {
    console.error('[install-git-hooks] missing pre-commit hook file')
    process.exit(1)
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: root,
      stdio: 'ignore',
    })
  } catch {
    console.warn('[install-git-hooks] not a git repo; skip')
    return
  }

  // relative path works better on Windows + portable clones
  const relativeHooks = 'scripts/git-hooks'
  execSync(`git config core.hooksPath ${relativeHooks}`, { cwd: root })

  // best-effort executable bit (no-op on Windows NTFS often, but fine)
  try {
    fs.chmodSync(preCommit, 0o755)
  } catch {
    // ignore
  }

  console.log(`[install-git-hooks] core.hooksPath = ${relativeHooks}`)
}

main()
