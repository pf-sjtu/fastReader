import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import zh from '../src/i18n/locales/zh.json'
import en from '../src/i18n/locales/en.json'

type Dict = { [k: string]: string | Dict }

function flatten(obj: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}

const SRC = resolve(__dirname, '../src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'cli' ? [] : walk(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

// 仅匹配首参为字面量的 t('x') / i18n.t('x')，模板字符串/变量等动态 key 跳过
const CALL = /(?<![\w.$])(?:i18n\.)?t\(\s*(['"])([A-Za-z0-9_.-]+)\1/g

function collectRefs(): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf-8')
    for (const m of text.matchAll(CALL)) {
      const line = text.slice(0, m.index).split('\n').length
      const list = refs.get(m[2]) ?? []
      list.push(`${relative(SRC, file)}:${line}`)
      refs.set(m[2], list)
    }
  }
  return refs
}

const zhFlat = flatten(zh as Dict)
const enFlat = flatten(en as Dict)

// i18next 复数：key_one / key_other 视为 key 存在
const has = (dict: Record<string, string>, key: string) =>
  key in dict || `${key}_one` in dict || `${key}_other` in dict

describe('i18n locales', () => {
  it('zh / en 扁平键集合一致', () => {
    const zhKeys = Object.keys(zhFlat).sort()
    const enKeys = Object.keys(enFlat).sort()
    expect(zhKeys.filter((k) => !(k in enFlat))).toEqual([])
    expect(enKeys.filter((k) => !(k in zhFlat))).toEqual([])
  })

  it('en 文案不含中文', () => {
    const cjk = Object.entries(enFlat)
      .filter(([, v]) => /[一-鿿]/.test(v))
      .map(([k]) => k)
    expect(cjk).toEqual([])
  })

  it('src 中所有 t(字面量) 引用（含带 defaultValue 的）都存在于两份 locale', () => {
    const refs = collectRefs()
    expect(refs.size).toBeGreaterThan(100)
    const missing = [...refs.entries()]
      .filter(([k]) => !has(zhFlat, k) || !has(enFlat, k))
      .map(([k, where]) => `${k} @ ${where[0]}`)
    expect(missing).toEqual([])
  })
})
