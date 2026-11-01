import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 设计一致性守卫（规格 design-system）：
 * 业务组件不写调色板色、零散字号、裸圆角；标题用 t-* 角色类，状态色用 success/warning/info/destructive token。
 * 例外必须登记在 EXEMPT 里并写明理由。
 */
const SRC = join(process.cwd(), 'src')

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const rel = (p: string) => relative(process.cwd(), p).split(sep).join('/')

/** 文件 → 允许跳过的规则 id → 理由 */
const EXEMPT: Record<string, Record<string, string>> = {
  'src/components/study/AskPanel.tsx': { radius: '聊天气泡的非对称圆角' },
  'src/components/app/AppHeader.tsx': { 'heading-role': 'h1 只是品牌字标 BrandMark 的语义容器，字样式在字标内部' },
  'src/components/BrandMark.tsx': { px: '品牌字标的装饰尺寸' },
  'src/components/library/BookCover.tsx': { px: '封面水印大字' },
}

/** unless：行里出现它就不算违规（用来表达「必须带某个类」，避免写难读的负向先行断言） */
const RULES: { id: string; re: RegExp; unless?: RegExp; hint: string; skipDirs?: string[] }[] = [
  {
    id: 'palette',
    re: /\b(?:text|bg|border|ring|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|yellow|orange|emerald|purple|teal|cyan|sky|indigo|violet|pink|rose|lime)-\d{2,3}/,
    hint: '用语义 token：success / warning / info / destructive / muted / primary',
  },
  { id: 'radius', re: /(?<![\w-])rounded(?:-sm|-xl|-2xl)?(?![\w-])/, hint: '圆角只用 rounded-md（控件）/ rounded-lg（容器）/ rounded-full', skipDirs: ['src/charts'] },
  { id: 'px', re: /text-\[(?:9|10|11)px\]/, hint: '不使用 ≤11px 文字；用 text-xs（12px）' },
  { id: 'title-size', re: /<(?:CardTitle|DialogTitle|SheetTitle)\b[^>]*\btext-(?:xs|sm|base|lg|xl|2xl)\b/, hint: '标题用组件默认（t-title）或 t-display，不覆写字号' },
  { id: 'heading-role', re: /<h[1-6]/, unless: /t-(?:display|title|section|label|caption)/, hint: '标题标签必须带文字角色类 t-display / t-title / t-section / t-label / t-caption' },
  { id: 'heading-size', re: /<h[1-6]\b[^>]*\btext-(?:base|lg|xl|2xl)\b/, hint: '标题用 t-title / t-section / t-label 角色类' },
]

describe('设计一致性守卫', () => {
  const files = tsxFiles(SRC)

  for (const rule of RULES) {
    it(`没有违反「${rule.id}」：${rule.hint}`, () => {
      const hits: string[] = []
      for (const file of files) {
        const r = rel(file)
        if (rule.skipDirs?.some((d) => r.startsWith(d))) continue
        if (EXEMPT[r]?.[rule.id]) continue
        readFileSync(file, 'utf-8')
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (rule.re.test(line) && !rule.unless?.test(line)) hits.push(`${r}:${i + 1}  ${line.trim().slice(0, 100)}`)
          })
      }
      expect(hits, `\n${hits.join('\n')}\n`).toEqual([])
    })
  }

  it('每条豁免都写了理由', () => {
    for (const [file, rules] of Object.entries(EXEMPT)) {
      for (const [id, why] of Object.entries(rules)) expect(why.length, `${file}/${id}`).toBeGreaterThan(3)
    }
  })

  it('文字角色类已在 index.css 定义', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf-8')
    for (const cls of ['t-display', 't-title', 't-section', 't-label', 't-caption']) expect(css).toContain(`.${cls}`)
    for (const token of ['--success', '--warning', '--info']) expect(css.match(new RegExp(`${token}:`, 'g'))?.length).toBe(2)
  })
})
