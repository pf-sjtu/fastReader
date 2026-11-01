/**
 * 书库卡片角标（task-5）：
 * ① 左上推荐语与右上分类顶端对齐——jsdom 不做布局，所以断言的是「两侧几何口径一致」的结构前提：
 *    两栏都是 flex 容器，胶囊两侧都是被 blockify 的 flex 子项（不是 inline）。
 * ② 分类角标按分类各用自己的颜色——色调表用纯函数 categoryTone 暴露，这里断言映射完备、
 *    分类色只来自语义 token（red/green-500 这种调色板硬编码会被 designSystem 守卫拦），
 *    并从 index.css 现读 oklch 值做白字对比度校验。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from '../../src/i18n'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mount } from '../uiTestUtils'

// 分类文案走 i18n；不初始化就只能拿到 library.categories.* 键名
let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

// 只隔离 WebDAV：书库 IO 在 jsdom 里会真的去碰 IndexedDB / 请求封面
vi.mock('@/services/webdavService', () => ({
  webdavService: { isInitialized: () => false, onInitialized: () => () => {} },
}))

import { BookCard, CATEGORY_PILL_BG, CATEGORY_PILL_BASE } from '@/components/library/BookCard'
import { CATEGORY_KEYS, CATEGORY_TONES, DEFAULT_CATEGORY_TONE, categoryTone, type CategoryTone } from '@/components/library/labels'
import type { LibraryEntry } from '@/services/library/types'

const TONES: CategoryTone[] = ['primary', 'info', 'success', 'warning', 'destructive']
const entry = (extra: Partial<LibraryEntry> = {}): LibraryEntry =>
  ({ path: '/s/甲.epub', size: 1, mtime: '', title: '甲', status: 'unprocessed', stale: false, missingScans: 0, updatedAt: 1, ...extra }) as LibraryEntry
const card = (extra: Partial<LibraryEntry>, caption?: string) =>
  mount(<BookCard entry={entry(extra)} opening={false} disabled={false} onOpen={() => {}} onInfo={() => {}} caption={caption} compact />)
const corner = (m: ReturnType<typeof mount>) => m.container.querySelector<HTMLElement>('[data-slot="book-corner"]')!
const cols = (m: ReturnType<typeof mount>) => Array.from(corner(m).children) as HTMLElement[]
/** 胶囊是这批 span 里带 rounded-full 的那个（封面上别的 span 没有） */
const pillIn = (el: HTMLElement) => el.querySelector<HTMLElement>('span.rounded-full')!

describe('分类 → 色调映射（categoryTone 纯函数）', () => {
  it('词表里每个分类都有确定的色调（加了新分类忘了配上色，角标会退回兜底色）', () => {
    for (const name of Object.keys(CATEGORY_KEYS)) expect(TONES, `${name} 缺少色调`).toContain(categoryTone(name))
  })

  it('色调表没有多余条目（避免映射悄悄漂移）', () => {
    const known = new Set([...Object.keys(CATEGORY_KEYS), ...Object.keys(CATEGORY_TONES)])
    for (const name of Object.keys(CATEGORY_TONES)) expect(known.has(name), `多余的色调条目：${name}`).toBe(true)
    for (const name of Object.keys(CATEGORY_KEYS)) expect(Object.hasOwn(CATEGORY_TONES, name), `${name} 未显式登记色调`).toBe(true)
  })

  it('未收录分类落到确定的兜底色，且对大小写与原样分类稳定', () => {
    expect(categoryTone('Options (Finance)')).toBe(DEFAULT_CATEGORY_TONE)
    expect(categoryTone('')).toBe(DEFAULT_CATEGORY_TONE)
    expect(categoryTone('business')).toBe(DEFAULT_CATEGORY_TONE) // 词表是大小写敏感的英文 dc:subject
    expect(categoryTone('Business')).toBe('primary')
  })

  it('几个高频分类落在各自的语义组里', () => {
    expect(categoryTone('Business')).toBe('primary')
    expect(categoryTone('Self Help')).toBe('success')
    expect(categoryTone('Science')).toBe('info')
    expect(categoryTone('History')).toBe('warning')
    expect(categoryTone('Politics')).toBe('destructive')
  })
})

describe('分类胶囊的类名', () => {
  it('每档都只引用语义 token，不写调色板硬编码（red-500 / gray-200 之类）', () => {
    const palette = /\b(?:text|bg|border|ring|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|yellow|orange|emerald|purple|teal|cyan|sky|indigo|violet|pink|rose|lime)-\d{2,3}/
    for (const tone of TONES) {
      const cls = CATEGORY_PILL_BG[tone]
      expect(cls, `${tone} 用了调色板色`).not.toMatch(palette)
      expect(cls, `${tone} 应引用自己的语义 token`).toContain(`var(--${tone})`)
    }
  })

  it('分类色压暗后仍是白字胶囊，动态值也保留基础样式（截断 / 圆角 / 玻璃底）', () => {
    for (const tone of TONES) {
      expect(CATEGORY_PILL_BASE(tone)).toContain(CATEGORY_PILL_BG[tone])
      expect(CATEGORY_PILL_BASE(tone)).toContain('rounded-full')
      expect(CATEGORY_PILL_BASE(tone)).toContain('text-white')
      expect(CATEGORY_PILL_BASE(tone)).toContain('backdrop-blur-sm')
      expect(CATEGORY_PILL_BASE(tone)).toContain('truncate')
      expect(CATEGORY_PILL_BASE(tone)).toContain('whitespace-nowrap')
    }
  })
})

describe('分类胶囊在封面上的可读性（白字 / 语义色 45% + 黑 55%）', () => {
  const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

  /** 取 :root（浅色）或 .dark（暗色）块里某个 token 的 oklch 分量 */
  function token(name: string, theme: 'light' | 'dark'): [number, number, number] {
    const open = theme === 'light' ? /:root\s*\{/ : /\.dark\s*\{/
    const start = open.exec(CSS)
    if (!start) throw new Error(`index.css 找不到 ${theme === 'light' ? ':root' : '.dark'} 块`)
    const block = CSS.slice(start.index, CSS.indexOf('}', start.index))
    const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.-]+)\\s+([\\d.-]+)\\s+([\\d.-]+)`).exec(block)
    if (!m) throw new Error(`${theme} 主题缺少 --${name} 的 oklch 定义（色调表引用了它）`)
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }

  // oklch → 编码 sRGB，再按 CSS 语义在 sRGB 空间做 alpha 合成（浏览器就是这么算的）
  const clamp = (c: number) => Math.min(1, Math.max(0, c))
  const lin2srgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055)
  const srgb2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const LUM = (rgb: number[]) => 0.2126 * srgb2lin(rgb[0]) + 0.7152 * srgb2lin(rgb[1]) + 0.0722 * srgb2lin(rgb[2])
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const over = (dst: number[], src: number[], a: number) => src.map((c, i) => dst[i] * (1 - a) + c * a)
  const enc = ([L, C, h]: [number, number, number]) => {
    const rad = (h * Math.PI) / 180
    const A = C * Math.cos(rad)
    const B = C * Math.sin(rad)
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    return lin.map((c) => clamp(lin2srgb(clamp(c))))
  }
  /** 胶囊底：语义色 45% + 黑 55%（写进 color-mix 的那一层）；BLACK 由覆盖在封面上的压暗层提供 */
  const pillBase = (tone: CategoryTone, theme: 'light' | 'dark') => enc(token(tone, theme)).map((c) => c * 0.45)

  it.each(['light', 'dark'] as const)('%s 主题：任一分类角标上的白字都 ≥ 4.5:1（最坏情况＝纯白封面）', (theme) => {
    for (const tone of TONES) {
      const worst = ratio(1, LUM(pillBase(tone, theme)))
      expect(worst, `${theme} / ${tone} 白字对比度 ${worst.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('两套主题下的颜色可区分（暗色主题 token 变亮，但角标不会跟着浅到读不清）', () => {
    for (const tone of TONES) {
      const light = LUM(pillBase(tone, 'light'))
      const dark = LUM(pillBase(tone, 'dark'))
      // 两主题的压暗底本来就会互相靠近（都是 45% 语义色）；只要不是「暗色下浅到读不清」
      expect(ratio(light, dark), `${tone} 两主题差异过小`).toBeGreaterThan(1.2)
    }
  })
})

describe('卡片 DOM：左右角标的几何口径一致 + 分类上色', () => {
  it('角标行由顶部对齐的 flex 排布，两栏都是 flex 容器', () => {
    const m = card({ subjects: ['Business'] }, '未翻开')
    const row = corner(m)
    expect(row.className).toContain('flex')
    expect(row.className).toContain('items-start')
    for (const col of cols(m)) expect(col.className).toContain('flex')
    m.unmount()
  })

  it('两侧胶囊都是被 blockify 的 flex 子项（inline 盒的 padding 不撑行盒，才会顶端不齐）', () => {
    const m = card({ subjects: ['Business'] }, '未翻开')
    const [left, right] = cols(m)
    const leftPill = pillIn(left)
    const rightPill = pillIn(right)
    // 注意：jsdom 不会加载 Tailwind 生成的 CSS，getComputedStyle 只会给浏览器默认值
    // （display: 'block'），所以这里只能断言 class 前提：胶囊的直接父元素是 flex 容器 →
    // 子项在浏览器里被 blockify，纵向 padding 计入盒高，左右两侧几何口径才一致。
    expect(leftPill.parentElement).toBe(left)
    expect(rightPill.parentElement).toBe(right)
    expect(leftPill.parentElement!.className).toContain('flex')
    expect(rightPill.parentElement!.className).toContain('flex')
    expect(left.className).toContain('items-start')
    m.unmount()
  })

  it('分类角标用主分类的色调；次要分类不上色也不显示', () => {
    const m = card({ subjects: ['History', 'Economics'] })
    const pill = pillIn(cols(m)[1])
    expect(pill.textContent).toBe('历史')
    expect(pill.className).toContain(CATEGORY_PILL_BG[categoryTone('History')])
    expect(pill.className).not.toContain(CATEGORY_PILL_BG[categoryTone('Economics')])
    m.unmount()
  })

  it('推荐语角标仍是中性底色（不抢分类色的语义）', () => {
    const m = card({ subjects: ['Business'] }, '未翻开')
    const leftPill = pillIn(cols(m)[0])
    expect(leftPill.className).toContain('bg-black/45')
    expect(leftPill.className).not.toMatch(/var\(--/)
    m.unmount()
  })

  it('没有分类时不渲染分类胶囊（左上推荐语照旧）', () => {
    const m = card({}, '未翻开')
    const spans = corner(m).querySelectorAll('span')
    expect(spans).toHaveLength(1)
    expect(spans[0].textContent).toBe('未翻开')
    m.unmount()
  })

  it('分类胶囊不带静态黑底（否则产物里后输出的 .bg-black/45 会盖掉分类色）', () => {
    for (const tone of TONES) {
      const cls = CATEGORY_PILL_BASE(tone)
      expect(cls, `${tone} 混进了静态黑底`).not.toContain('bg-black')
      expect(cls).toContain(CATEGORY_PILL_BG[tone])
    }
  })

  it('每一档分类色彼此不同（同名色会让分类仍然分不开）', () => {
    const classes = TONES.map((tone) => CATEGORY_PILL_BG[tone])
    expect(new Set(classes).size).toBe(TONES.length)
  })
})
