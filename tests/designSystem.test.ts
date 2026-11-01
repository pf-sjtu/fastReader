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
    // 也扫 .ts：类名经常写在常量表、`cn()` 拼接或样式映射里，只扫 .tsx 会漏
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

const rel = (p: string) => relative(process.cwd(), p).split(sep).join('/')

/** 文件 → 允许跳过的规则 id → 理由 */
const EXEMPT: Record<string, Record<string, string>> = {
  'src/components/study/AskPanel.tsx': { radius: '聊天气泡的非对称圆角', 'button-height': '发送/取消按钮要与同高的输入框对齐（size-10）' },
  'src/components/app/AppHeader.tsx': { 'heading-role': 'h1 只是品牌字标 BrandMark 的语义容器，字样式在字标内部' },
  'src/components/BrandMark.tsx': { px: '品牌字标的装饰尺寸', 'raw-color': '印章 logo 的品牌色是固定值，不跟主题走' },
  'src/components/library/BookCover.tsx': { px: '封面水印大字' },
  'src/components/library/BookCard.tsx': { 'empty-state': '封面加载态的遮罩，不是页级空状态，需要绝对定位覆盖在封面上' },
  'src/charts/plugins/entity-timeline/EntityTimelineChart.tsx': { 'empty-state': '时间轴的空白格（网格单元内居中），不是页级空状态' },
  'src/study/pack/buildPack.ts': { 'heading-role': '离线学习包是独立 HTML 文档，h1–h4 是导出产物的标签，用不到应用内角色类', 'raw-color': '离线学习包的内嵌样式表是独立 HTML 文档，读不到宿主 CSS 变量' },
  'src/lib/htmlSandbox.ts': { 'raw-color': '注入 iframe 沙箱文档内的基础样式，读不到宿主 CSS 变量' },
  'src/study/exportFigures.ts': { 'raw-color': '导出的 SVG 进 data URI 后读不到宿主 CSS 变量，必须写具体色值（与 index.css 亮色 token 对齐，有测试守着 NOTE_PALETTE）' },
  'src/utils/mindmapExport.ts': { 'raw-color': 'canvas 导出用的纯色底，同样读不到 CSS 变量' },
  'src/components/EpubReader.tsx': { 'raw-color': 'EPUB 正文样式注入 iframe 内部文档，读不到宿主 CSS 变量，只能写具体色值' },
  'src/components/PdfReader.tsx': { 'raw-color': 'PDF canvas 的背景/边框色，同样在宿主 CSS 之外' },
}

/** unless：行里出现它就不算违规（用来表达「必须带某个类」，避免写难读的负向先行断言） */
const RULES: { id: string; re: RegExp; unless?: RegExp; hint: string; skipDirs?: string[]; except?: string[] }[] = [
  {
    id: 'palette',
    re: /\b(?:text|bg|border|ring|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|yellow|orange|emerald|purple|teal|cyan|sky|indigo|violet|pink|rose|lime)-\d{2,3}/,
    hint: '用语义 token：success / warning / info / danger（destructive）/ muted / primary',
  },
  { id: 'radius', re: /(?<![\w-])rounded(?:-sm|-xl|-2xl)?(?![\w-])/, hint: '圆角只用 rounded-md（控件）/ rounded-lg（容器）/ rounded-full', skipDirs: ['src/charts'] },
  { id: 'px', re: /text-\[(?:9|10|11)px\]/, hint: '不使用 ≤11px 文字；用 text-xs（12px）' },
  { id: 'title-size', re: /<(?:CardTitle|DialogTitle|SheetTitle)\b[^>]*\btext-(?:xs|sm|base|lg|xl|2xl)\b/, hint: '标题用组件默认（t-title）或 t-display，不覆写字号' },
  { id: 'heading-role', re: /<h[1-6]/, unless: /t-(?:display|title|section|label|caption|body)/, hint: '标题标签必须带文字角色类 t-display / t-title / t-section / t-label / t-body / t-caption' },
  { id: 'button-height', re: /<Button(?![\w])[^>]*className="[^"]*(?<![\w-])(?:h|size)-(?:7|8|9|10)(?![\w-])/, hint: '按钮高度用 size 档位：xs(h-7) / sm(h-8) / default(h-9) / lg(h-10) / icon-xs|icon-sm|icon，不在 className 里覆写' },
  { id: 'heading-size', re: /<h[1-6]\b[^>]*\btext-(?:base|lg|xl|2xl)\b/, hint: '标题用 t-title / t-section / t-label 角色类' },
  {
    id: 'skeleton',
    re: /animate-pulse/,
    hint: '骨架屏统一用 @/components/ui/skeleton 的 Skeleton / SkeletonText / SkeletonList，不手写 animate-pulse',
    except: ['src/components/ui/skeleton.tsx'],
  },
  {
    id: 'empty-state',
    re: /flex flex-col items-center justify-center/,
    hint: '空状态统一用 @/components/ui/empty-state 的 EmptyState，不各页自拼容器',
    except: ['src/components/ui/empty-state.tsx'],
  },
  {
    id: 'raw-color',
    re: /(?<!&)#[0-9a-fA-F]{3,8}\b/,
    hint: '组件里不写十六进制颜色；用语义 token（图表导出等确实要具体色值的场景登记在 EXEMPT）',
    skipDirs: ['src/charts', 'src/components/markdown/genui'],
  },
  {
    // 只拦「把颜色函数塞进 Tailwind 的任意值颜色工具类」：阴影/渐变里的 rgb(...) 之类不算
    id: 'raw-color-fn',
    re: /\b(?:text|bg|border|ring|fill|stroke|from|via|to)-\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\()/,
    hint: '不用任意值颜色函数（text-[rgb(...)] / bg-[#fff]）；用语义 token',
    skipDirs: ['src/charts', 'src/components/markdown/genui'],
  },
  {
    // 静态扫描看不进运行时的字符串：模板插值拼出来的颜色类（`text-${tone}-500`）必须换成分档映射表
    id: 'dynamic-palette',
    re: /(?<![\w-])(?:text|bg|border|ring|fill|stroke|from|via|to)-\$\{/,
    hint: '颜色类不能用模板插值拼（`text-${tone}-500`）；改成显式映射或语义 token',
    skipDirs: ['src/charts', 'src/components/markdown/genui'],
  },
]

describe('设计一致性守卫', () => {
  const files = tsxFiles(SRC)

  for (const rule of RULES) {
    it(`没有违反「${rule.id}」：${rule.hint}`, () => {
      const hits: string[] = []
      for (const file of files) {
        const r = rel(file)
        if (rule.skipDirs?.some((d) => r.startsWith(d))) continue
        if (rule.except?.includes(r)) continue
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
    for (const cls of ['t-display', 't-title', 't-section', 't-label', 't-body', 't-caption']) expect(css).toContain(`.${cls}`)
    for (const token of ['--success', '--warning', '--info', '--destructive']) expect(css.match(new RegExp(`${token}:`, 'g'))?.length).toBe(2)
  })

  it('状态色的配套 token（-foreground / -muted / danger 别名）深浅主题各一套', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf-8')
    const twice = (token: string) => expect(css.match(new RegExp(`\\${token}:`, 'g'))?.length, token).toBe(2)
    for (const token of [
      '--danger',
      '--success-foreground',
      '--warning-foreground',
      '--info-foreground',
      '--destructive-foreground',
      '--danger-foreground',
      '--success-muted',
      '--warning-muted',
      '--info-muted',
      '--destructive-muted',
      '--danger-muted',
    ]) twice(token)
    // 别名必须指向 destructive，避免两套危险色漂移
    expect(css).toContain('--danger: var(--destructive)')
    // 深色主题里四个实心底前景都该是同一个墨色：深色状态色本身已提亮，
    // 近白前景在提亮后的 destructive 上只有 ~3:1（独立审查实测），墨色约 5:1。
    const dark = css.slice(css.indexOf('.dark'))
    for (const token of ['--success-foreground', '--warning-foreground', '--info-foreground', '--destructive-foreground'])
      expect(dark, `${token} 在深色主题应沿用墨色`).toContain(`${token}: oklch(0.1750 0.0080 50.0)`)
    // Tailwind 侧映射齐全，业务才能写 bg-success-muted / text-danger 这类类名
    for (const mapped of ['--color-danger:', '--color-danger-foreground:', '--color-danger-muted:', '--color-success-muted:', '--color-success-foreground:', '--color-warning-muted:', '--color-info-muted:', '--color-destructive-muted:'])
      expect(css).toContain(mapped)
  })

  it('共享组件存在（分部标题 / 面板头部 / 列表行 / 骨架屏 / 空状态）', () => {
    for (const p of ['ui/section-heading.tsx', 'ui/list-row.tsx', 'ui/skeleton.tsx', 'ui/empty-state.tsx'])
      expect(() => statSync(join(SRC, 'components', p))).not.toThrow()
    const heading = readFileSync(join(SRC, 'components/ui/section-heading.tsx'), 'utf-8')
    expect(heading).toContain('export function SectionHeading')
    expect(heading).toContain('export function PanelHeader')
  })
})
