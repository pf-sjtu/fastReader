import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, flush } from '../uiTestUtils'
import { ChartsPanel } from '@/charts/ChartsPanel'
import type { BookCharts } from '@/charts/types'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

// 没有可展示的数据也会渲染工具栏（含错误/空状态），足以测工具栏本身
const charts = { version: 1 } as unknown as BookCharts
const trigger = () => m!.container.querySelector<HTMLButtonElement>('button[aria-label="图表操作"]')
const openMenu = async () => {
  act(() => {
    trigger()!.focus()
    trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await flush()
}
const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))

describe('ChartsPanel 工具栏：插槽 + 一个「图表操作」菜单', () => {
  it('不再有两枚常驻的文字按钮；重新生成/清除缓存都在菜单里', async () => {
    m = mount(<ChartsPanel charts={charts} onlyPlugin="entity-graph" canRegenerate onRegenerate={vi.fn()} onClearCache={vi.fn()} />)
    const visibleButtonLabels = Array.from(m.container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(visibleButtonLabels.some((l) => l?.includes('重新生成图表') || l?.includes('清除图表缓存'))).toBe(false)
    await openMenu()
    expect(items().map((i) => i.textContent?.trim())).toEqual(['重新生成图表', '清除图表缓存'])
  })

  it('菜单项触发对应回调', async () => {
    const onRegenerate = vi.fn()
    const onClearCache = vi.fn()
    m = mount(<ChartsPanel charts={charts} onlyPlugin="entity-graph" canRegenerate onRegenerate={onRegenerate} onClearCache={onClearCache} />)
    await openMenu()
    act(() => items()[1].click())
    expect(onClearCache).toHaveBeenCalledTimes(1)
    await openMenu()
    act(() => items()[0].click())
    await flush()
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('toolbarSlot 与菜单在同一行（同一个 flex 行容器）', () => {
    m = mount(<ChartsPanel charts={charts} onlyPlugin="entity-graph" canRegenerate onRegenerate={vi.fn()} toolbarSlot={<label>与正文同色</label>} />)
    const row = trigger()!.parentElement!
    expect(row.textContent).toContain('与正文同色')
  })

  it('没有任何数据级操作可提供：不渲染菜单；只有插槽时只渲染插槽', () => {
    m = mount(<ChartsPanel charts={charts} onlyPlugin="entity-graph" toolbarSlot={<label>与正文同色</label>} />)
    expect(trigger()).toBeNull()
    expect(m.container.textContent).toContain('与正文同色')
  })

  it('只能重新生成（没有缓存可清）：菜单里只有一项，没有多余分隔线', async () => {
    m = mount(<ChartsPanel charts={undefined} onlyPlugin="entity-graph" canRegenerate onRegenerate={vi.fn()} onClearCache={vi.fn()} />)
    await openMenu()
    expect(items().map((i) => i.textContent?.trim())).toEqual(['重新生成图表'])
    expect(document.querySelector('[role="separator"]')).toBeNull()
  })
})

describe('ChartsPanel：生成前预估与生成中取消', () => {
  it('空状态：「生成」按钮下方显示预估插槽', () => {
    m = mount(<ChartsPanel charts={null} canRegenerate onRegenerate={vi.fn()} estimateSlot={<p data-testid="est">约 3 万 token</p>} />)
    expect(m.container.querySelector('[data-testid="est"]')?.textContent).toBe('约 3 万 token')
  })

  it('生成中（尚无图表）：显示「取消生成」并触发回调；没传 onCancel 则不显示', () => {
    const onCancel = vi.fn()
    m = mount(<ChartsPanel charts={null} generating onCancel={onCancel} />)
    const btn = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent?.includes('取消生成'))!
    act(() => btn.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
    m.rerender(<ChartsPanel charts={null} generating />)
    expect(Array.from(m.container.querySelectorAll('button')).some((b) => b.textContent?.includes('取消生成'))).toBe(false)
  })

  it('已有图表重新生成时，「图表操作」菜单里出现「取消生成」', async () => {
    const onCancel = vi.fn()
    m = mount(<ChartsPanel charts={charts} onlyPlugin="entity-graph" generating canRegenerate onRegenerate={vi.fn()} onCancel={onCancel} />)
    await openMenu()
    const cancel = items().find((i) => i.textContent?.includes('取消生成'))!
    act(() => cancel.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
