/**
 * i18n 覆盖率门禁：代码里用到的字面量 key 必须在 zh/en 两个 locale 中都存在。
 *
 * 历史上漏过 6 个 key（batch.selectAll / fileCount / queueTitle / chapterCount /
 * toast.startedDesc / toast.itemPartialDesc），界面上直接显示原始 key 名。
 * 这里用源码扫描兜住：新增 key 忘了翻译就会红。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(__dirname, '../src')
const LOCALES = resolve(__dirname, '../src/i18n/locales')

type LocaleTree = Record<string, unknown>

function loadLocale(name: string): LocaleTree {
  return JSON.parse(readFileSync(join(LOCALES, `${name}.json`), 'utf8')) as LocaleTree
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walkFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** 收集源码里 `t('a.b')` / `t("a.b")` 的字面量 key（跳过模板字符串与 i18n/locales） */
function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const pattern = /\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1/g

  for (const file of walkFiles(SRC)) {
    if (file.includes(`${'i18n'}/locales`)) continue
    const source = readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const key = match[2]
      // 形如 `t('common')` 这种取命名空间的调用不算 key
      const list = used.get(key) ?? []
      if (!list.includes(file)) list.push(file)
      used.set(key, list)
    }
  }
  return used
}

function hasKey(tree: LocaleTree, key: string): boolean {
  const parts = key.split('.')
  let node: unknown = tree
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return false
    const record = node as Record<string, unknown>
    if (!(part in record)) return false
    node = record[part]
  }
  return node !== undefined && node !== null && node !== ''
}

describe('i18n key 覆盖', () => {
  const used = collectUsedKeys()

  it('扫描到了足够多的 key（防止正则失效导致门禁形同虚设）', () => {
    expect(used.size).toBeGreaterThan(150)
  })

  it('中文 locale 覆盖所有代码中使用的 key', () => {
    const zh = loadLocale('zh')
    const missing = [...used.entries()]
      .filter(([key]) => !hasKey(zh, key))
      .map(([key, files]) => `${key} (${files.map((f) => f.replace(SRC, 'src')).join(', ')})`)
    expect(missing).toEqual([])
  })

  it('英文 locale 覆盖所有代码中使用的 key', () => {
    const en = loadLocale('en')
    const missing = [...used.entries()]
      .filter(([key]) => !hasKey(en, key))
      .map(([key, files]) => `${key} (${files.map((f) => f.replace(SRC, 'src')).join(', ')})`)
    expect(missing).toEqual([])
  })

  it('zh 与 en 的 key 结构一致（没有单边新增）', () => {
    const flatten = (tree: LocaleTree, prefix = ''): string[] =>
      Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key
        return value !== null && typeof value === 'object'
          ? flatten(value as LocaleTree, path)
          : [path]
      })

    const zh = new Set(flatten(loadLocale('zh')))
    const en = new Set(flatten(loadLocale('en')))

    expect([...zh].filter((key) => !en.has(key))).toEqual([])
    expect([...en].filter((key) => !zh.has(key))).toEqual([])
  })
})
