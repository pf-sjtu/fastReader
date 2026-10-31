import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { mount, click, flush } from '../uiTestUtils'
import { FontSettings } from '@/components/project/FontSettings'
import { useReadingFocusStore } from '@/stores/readingFocus'
import { canvasMeasure, checkStack, fontStatus, isGenericFamily, parseFontStack, type MeasureFn } from '@/utils/fontCheck'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

/** 假字体环境：已安装的字体宽度 = 基线宽度 + 偏移，其余与基线相同 */
const fakeMeasure = (installed: string[]): MeasureFn => (font) => {
  const m = /^48px (?:"([^"]+)", )?(monospace|serif|sans-serif)$/.exec(font)
  if (!m) return null
  const base = { monospace: 100, serif: 120, 'sans-serif': 140 }[m[2] as 'monospace']
  return m[1] && installed.includes(m[1]) ? base + 7 : base
}

describe('parseFontStack', () => {
  it('去引号与空白，引号内的逗号不切分', () => {
    expect(parseFontStack(' "PingFang SC", "Microsoft YaHei", system-ui,sans-serif ')).toEqual(['PingFang SC', 'Microsoft YaHei', 'system-ui', 'sans-serif'])
    expect(parseFontStack('"A, B", serif')).toEqual(['A, B', 'serif'])
    expect(parseFontStack('')).toEqual([])
  })
  it('通用族名识别（大小写不敏感）', () => {
    expect(isGenericFamily('System-UI')).toBe(true)
    expect(isGenericFamily('Georgia')).toBe(false)
  })
})

describe('fontStatus / checkStack', () => {
  it('三种基线下宽度都与基线相同 → missing；有一个不同 → installed', () => {
    expect(fontStatus('Noto Sans SC', fakeMeasure([]))).toBe('missing')
    expect(fontStatus('Noto Sans SC', fakeMeasure(['Noto Sans SC']))).toBe('installed')
  })
  it('量不出（无 canvas）→ unknown，不冒充 missing', () => {
    expect(fontStatus('X', () => null)).toBe('unknown')
  })
  it('active = 栈内第一个已安装的具名字体（顺序决定优先级，而非安装先后）', () => {
    const r = checkStack(['A', 'B', 'C', 'sans-serif'], fakeMeasure(['C', 'B']))
    expect(r.active).toBe('B')
    expect(r.items.map((i) => i.status)).toEqual(['missing', 'installed', 'installed', 'generic'])
    expect(r.noneInstalled).toBe(false)
  })
  it('一个都没装：active 为空，noneInstalled 为真；全 unknown 时不报警', () => {
    const none = checkStack(['A', 'serif'], fakeMeasure([]))
    expect(none.active).toBeNull()
    expect(none.noneInstalled).toBe(true)
    expect(checkStack(['A', 'serif'], () => null).noneInstalled).toBe(false)
  })
  it('jsdom 无 canvas 时 canvasMeasure 恒返回 null', () => {
    expect(canvasMeasure()('48px serif')).toBeNull()
  })
})

describe('FontSettings 面板', () => {
  let mounted: ReturnType<typeof mount> | null = null
  beforeEach(() => {
    useReadingFocusStore.setState({ readingFont: 'sans' })
    // jsdom 读不到 index.css：手动给根元素放字体栈（与 index.css 同名变量）
    const root = document.documentElement.style
    root.setProperty('--font-sans', '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif')
    root.setProperty('--font-serif', '"Songti SC", "Noto Serif SC", serif')
    root.setProperty('--font-mono', 'Consolas, monospace')
  })
  afterEach(() => {
    mounted?.unmount()
    mounted = null
    for (const v of ['--font-sans', '--font-serif', '--font-mono']) document.documentElement.style.removeProperty(v)
  })

  it('按优先级列出各角色，标注状态，只有第一个已安装的标「当前生效」', async () => {
    mounted = mount(<FontSettings measure={fakeMeasure(['Microsoft YaHei', 'Consolas'])} />)
    await flush()
    const sans = mounted.container.querySelector('[data-role="sans"]')!
    const rows = Array.from(sans.querySelectorAll('li'))
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['missing', 'installed', 'generic', 'generic'])
    expect(sans.textContent).toContain('当前生效')
    expect(rows[1].textContent).toContain('当前生效')
    expect(rows[0].textContent).not.toContain('当前生效')
    expect(mounted.container.querySelector('[data-role="mono"]')!.textContent).toContain('当前生效')
  })

  it('整条栈都没装：提示将使用系统默认字体', async () => {
    mounted = mount(<FontSettings measure={fakeMeasure([])} />)
    await flush()
    expect(mounted.container.querySelector('[data-role="serif"]')!.textContent).toContain('系统默认字体')
  })

  it('切换正文阅读字体写入 store', async () => {
    mounted = mount(<FontSettings measure={fakeMeasure([])} />)
    await flush()
    const serifBtn = Array.from(mounted.container.querySelectorAll('button[role="radio"]')).find((b) => b.textContent === '衬线')!
    click(serifBtn)
    await flush()
    expect(useReadingFocusStore.getState().readingFont).toBe('serif')
    expect(serifBtn.getAttribute('aria-checked')).toBe('true')
  })

  it('「重新检测」会按最新环境重测', async () => {
    const installed: string[] = []
    mounted = mount(<FontSettings measure={(f) => fakeMeasure(installed)(f)} />)
    await flush()
    expect(mounted.container.querySelector('[data-role="mono"]')!.textContent).not.toContain('当前生效')
    installed.push('Consolas')
    click(Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent?.includes('重新检测'))!)
    await flush()
    expect(mounted.container.querySelector('[data-role="mono"]')!.textContent).toContain('当前生效')
  })
})

describe('readingFont 偏好', () => {
  it('持久化字段只认 sans/serif，其他值归一为 sans', async () => {
    const opts = useReadingFocusStore.persist.getOptions()
    const merged = opts.merge!({ readingFont: 'comic' }, useReadingFocusStore.getState())
    expect(merged.readingFont).toBe('sans')
    expect(opts.merge!({ readingFont: 'serif' }, useReadingFocusStore.getState()).readingFont).toBe('serif')
    expect(opts.partialize!(useReadingFocusStore.getState())).toHaveProperty('readingFont')
  })
})
