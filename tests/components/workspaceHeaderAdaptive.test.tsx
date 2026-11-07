// 顶栏自适应与卡片表头的结构性守卫：
// 这些是「狭窄宽度才暴露、单测里看不到」的布局契约（容器查询 / 折叠 / 单列轨道），
// 样式类一改就可能悄悄回归，所以按结构断言。
import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, flush, type Mounted } from '../uiTestUtils'
import { AppHeader } from '@/components/app/AppHeader'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const classOf = (el: Element) => el.getAttribute('class') ?? ''

describe('工作台顶栏：按容器宽度逐级降级', () => {
  it('compact 顶栏是 @container，并把品牌/工具分成宽窄两档', async () => {
    m = mount(
      <AppHeader compact>
        <div className="min-w-0 flex-1">《书》解析结果</div>
      </AppHeader>
    )
    await flush()

    const root = m.container.firstElementChild as HTMLElement
    // 所有 @[...] 类都以「顶栏自身宽度」为基准，而不是视口：没有 @container 它们永远不会生效
    expect(classOf(root)).toContain('@container')
    expect(classOf(root)).toContain('flex-wrap')

    const all = Array.from(root.querySelectorAll<HTMLElement>('*'))
    const has = (needle: string) => all.some((el) => classOf(el).includes(needle))

    // 品牌：<512px 只有印章，≥512px 才有「咀华 / JUHUA」字标
    expect(has('@[512px]:hidden')).toBe(true)
    expect(has('@[512px]:inline-flex')).toBe(true)

    // 工具组：≥512px 是同步/语言/主题三件套，<512px 全部收进「更多操作」
    expect(has('@[512px]:flex')).toBe(true)
    const more = document.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')
    expect(more).toBeTruthy()
    // 折叠菜单的触发器只读图标也能操作：必须留可访问名称
    expect(more?.getAttribute('title')).toBe('更多操作')
  })

  it('书名不再被强制换行到第二行', async () => {
    m = mount(
      <AppHeader compact>
        <div className="min-w-0 flex-1" data-testid="workspace-title">《书》解析结果</div>
      </AppHeader>
    )
    await flush()

    const wrapper = m.container.querySelector('[data-testid="workspace-title"]')?.parentElement
    expect(wrapper).toBeTruthy()
    // 曾经的 `order-last basis-full` 会把整行顶栏挤成两行、白白多占高度
    expect(classOf(wrapper!).includes('basis-full')).toBe(false)
    expect(classOf(wrapper!).includes('order-last')).toBe(false)
    expect(classOf(wrapper!)).toContain('flex-1')
  })
})

describe('顶栏里的模型选择器：先于其它控件 icon 化', () => {
  it('模型名/思考强度/用量/箭头都按容器宽度分级显示', () => {
    const source = readFileSync(resolve('src/components/ModelSwitcher.tsx'), 'utf8')
    // 模型名是顶栏第一大头：<992px 只留 Brain/KeyRound 图标，靠 title 与 aria-label 说明当前模型
    expect(source).toContain('@[992px]:block')
    expect(source).toContain('@[1080px]:inline-flex')
    expect(source).toContain('@[1180px]:inline-flex')
    expect(source).toContain('title={label}')
  })
})

describe('CardHeader 的单列轨道', () => {
  it('表头用单列轨道，长标题不会把固定宽度的卡片撑破', async () => {
    m = mount(
      <Card>
        <CardHeader>
          <CardTitle>一个很长很长很长很长很长很长很长很长很长的章节标题</CardTitle>
        </CardHeader>
      </Card>
    )
    await flush()
    const header = m.container.querySelector('[data-slot="card-header"]')
    expect(header).toBeTruthy()
    // grid 的隐式列是 auto（minmax(auto, max-content)）：只写 grid 时会被 max-content 撑开
    expect(classOf(header!)).toContain('grid-cols-1')
  })
})
