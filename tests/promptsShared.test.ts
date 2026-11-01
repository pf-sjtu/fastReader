/**
 * 提示词一律放 src/services/prompts/config/（前端与 CLI 共用的单一来源），代码里只负责取出。
 * 这里守住两件事：① 代码里不能再出现大段提示词；② 两端读到的就是同一份文件。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAskBookPrompt, getQuizPrompt, getRichRepairPrompt, getStudyKitPrompt } from '../src/services/prompts/study'
import { getKeyChartsPrompt } from '../src/services/prompts/keyCharts'
import { getLanguageInstruction } from '../src/services/prompts/utils'
import { STUDY_KIT_FORMAT, QUIZ_FORMAT, RICH_REPAIR_FORMAT } from '../src/services/ai/structured'

const DIR = join(__dirname, '..', 'src', 'services', 'prompts')
const CFG = join(DIR, 'config')
const read = (f: string) => readFileSync(join(CFG, f), 'utf8').trim()

describe('提示词单一来源', () => {
  it('代码里不能再写大段提示词：services/prompts/*.ts 与 services/ai/*.ts 没有超过 200 字、含「你是」的模板字面量', () => {
    const files = [
      ...readdirSync(DIR).filter((f) => f.endsWith('.ts')).map((f) => join(DIR, f)),
      ...readdirSync(join(DIR, '..', 'ai')).filter((f) => f.endsWith('.ts')).map((f) => join(DIR, '..', 'ai', f)),
    ]
    const offenders: string[] = []
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/`([^`]{200,})`/g)) {
        if (/你是|You are/.test(m[1])) offenders.push(`${f}: ${m[1].slice(0, 30)}…`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('取出函数返回的就是 config 里的文件内容', () => {
    expect(getStudyKitPrompt()).toBe(read('study-kit.md'))
    expect(getQuizPrompt()).toBe(read('quiz.md'))
    expect(getAskBookPrompt()).toBe(read('ask-book.md'))
    expect(getRichRepairPrompt()).toBe(read('rich-repair.md'))
    expect(getKeyChartsPrompt()).toBe(read('key-charts.md'))
  })

  it('每份提示词带齐它的占位符', () => {
    expect(getStudyKitPrompt()).toMatch(/\{\{bookTitle\}\}[\s\S]*\{\{chapterSummaries\}\}/)
    expect(getQuizPrompt()).toMatch(/\{\{count\}\}[\s\S]*\{\{chapterSummaries\}\}/)
    expect(getAskBookPrompt()).toMatch(/\{\{question\}\}/)
    expect(getRichRepairPrompt()).toContain('{{blocks}}')
  })

  it('语言指令来自共享 JSON（auto 由前端按界面语言决定）', () => {
    const table = JSON.parse(read('language-instructions.json'))
    for (const l of ['zh', 'en', 'ja', 'fr', 'de', 'es', 'ru'] as const) expect(getLanguageInstruction(l)).toBe(table[l])
  })

  it('结构化输出 schema 来自共享 JSON', () => {
    expect(STUDY_KIT_FORMAT).toEqual(JSON.parse(read('study-kit.schema.json')))
    expect(QUIZ_FORMAT).toEqual(JSON.parse(read('quiz.schema.json')))
    expect(RICH_REPAIR_FORMAT).toEqual(JSON.parse(read('rich-repair.schema.json')))
  })
})
