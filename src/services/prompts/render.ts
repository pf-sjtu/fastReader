/**
 * Prompt 模板渲染（唯一语义，见 ./config/README.md「模板渲染语义」）
 * CLI 等价实现：src/cli/prompts.py render_prompt；跨端用例 tests/fixtures/prompts/render-cases.json
 */
import { logger } from '../../lib/logger'

export interface PromptVar {
  /** 占位符名，对应模板中的 {{name}} */
  name: string
  /** 模板未引用该变量时，回退追加段的标签 */
  label: string
  value: string
  /** 回退追加时值与标签同行（`标签: 值`），否则换行 */
  inline?: boolean
}

/** {{name}}，允许花括号内两侧空白；name 须以字母或下划线开头 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * 渲染模板：
 * 1. 模板中引用的已知占位符一次性替换（值中的 {{…}} 不会被二次替换）
 * 2. 未知占位符保留原样并告警
 * 3. 模板未引用的变量按顺序以「标签: 值」追加到末尾——每个变量恰好发送一次
 */
export function renderPrompt(template: string, vars: PromptVar[]): string {
  const byName = new Map(vars.map((v) => [v.name, v]))
  const used = new Set<string>()
  const unknown = new Set<string>()

  const rendered = (template || '').replace(PLACEHOLDER, (match, name: string) => {
    const v = byName.get(name)
    if (!v) {
      unknown.add(name)
      return match
    }
    used.add(name)
    return v.value
  })

  if (unknown.size > 0) {
    logger.warn(`[renderPrompt] 模板含未知占位符，已原样保留: ${[...unknown].join(', ')}`)
  }

  const appended = vars
    .filter((v) => !used.has(v.name))
    .map((v) => `${v.label}:${v.inline ? ' ' : '\n'}${v.value}`)
  if (appended.length === 0) return rendered

  const base = rendered.trimEnd()
  return [...(base ? [base] : []), ...appended].join('\n\n')
}
