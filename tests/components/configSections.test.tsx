import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { mount, click, findButton, flush, type Mounted } from '../uiTestUtils'
import { useLibraryStore } from '@/services/library/libraryStore'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'
import { ConfigStep } from '@/components/app/ConfigStep'
import { UnifiedStatusBar } from '@/components/UnifiedStatusBar'
import type { BookProcessing } from '@/components/app/types'

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

const noop = () => {}
const props = {
  webdavEnabled: true,
  onOpenBook: vi.fn(),
  openingPath: null,
  onLoadFromCloudCache: noop,
  onStartProcessing: noop,
  onSetSelection: noop,
  preview: null,
}
const emptyBook = { file: null } as unknown as BookProcessing

describe('配置页的「书库 / 处理」两段', () => {
  it('书库段：只渲染书架，不出现上传与配置卡', async () => {
    // 书架有数据、数据源加载动作为空操作：避免异步加载把空状态写回而触发 act 警告
    useLibraryStore.setState({
      index: applyScan(emptyIndex(0), [{ path: '/s/甲.epub', size: 1, mtime: 'm' }], { now: 1, summaryNameOf: (n) => `${n}-完整摘要.md`, summaryNames: new Set() }).index,
      fresh: true,
      error: null,
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadMirror: vi.fn().mockResolvedValue(undefined),
    })
    m = mount(<ConfigStep {...props} book={emptyBook} section="library" />)
    await flush()
    expect(m.container.querySelector('[aria-label="我的书库"]')).toBeTruthy()
    expect(m.container.textContent).not.toContain('文件上传与配置')
  })

  it('处理段：渲染上传与配置卡，并留一个「返回书库」入口', () => {
    const onSelectSection = vi.fn()
    m = mount(
      <ConfigStep {...props} book={emptyBook} section="process" onSelectSection={onSelectSection} />
    )
    expect(m.container.querySelector('[aria-label="我的书库"]')).toBeNull()
    expect(m.container.textContent).toContain('文件上传与配置')

    const back = findButton(/返回书库/)
    expect(back).toBeTruthy()
    click(back)
    expect(onSelectSection).toHaveBeenCalledWith('library')
  })

  it('WebDAV 未启用：没有书库段，处理段也不显示「返回书库」', () => {
    m = mount(
      <ConfigStep
        {...props}
        book={emptyBook}
        webdavEnabled={false}
        section="library"
        onSelectSection={noop}
      />
    )
    expect(m.container.textContent).toContain('文件上传与配置')
    expect(findButton(/返回书库/)).toBeFalsy()
  })
})

describe('顶栏的三阶段切换：书库 · 设置 · 处理', () => {
  const tabs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]'))
  const names = () => tabs().map((t) => t.getAttribute('aria-label'))
  const selected = () => tabs().filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.getAttribute('aria-label'))

  it('WebDAV 启用时是三段「书库 · 设置 · 处理」，只有当前阶段选中', () => {
    m = mount(<UnifiedStatusBar currentView="config" configSections configSection="library" onSelectConfigSection={vi.fn()} />)
    expect(names()).toEqual(['书库', '设置', '处理'])
    expect(selected()).toEqual(['书库'])
  })

  it('没有特殊按钮：不再有「进入处理界面」，三段都是平等的标签页', () => {
    m = mount(<UnifiedStatusBar currentView="config" configSections configSection="process" onSelectConfigSection={vi.fn()} onToggleView={vi.fn()} />)
    expect(findButton(/进入处理界面|返回配置/)).toBeUndefined()
    expect(m.container.querySelectorAll('[data-slot="status-nav"] button')).toHaveLength(3)
    expect(tabs().every((t) => t.getAttribute('role') === 'tab')).toBe(true)
  })

  it('配置页里点「书库 / 设置」只切段，不切视图；点「处理」进入处理视图', () => {
    const onSelect = vi.fn()
    const onToggle = vi.fn()
    m = mount(<UnifiedStatusBar currentView="config" configSections configSection="process" onSelectConfigSection={onSelect} onToggleView={onToggle} />)
    click(tabs()[1]) // 当前就在「设置」：无动作
    expect(onSelect).not.toHaveBeenCalled()
    click(tabs()[0]) // 书库
    expect(onSelect).toHaveBeenCalledWith('library')
    expect(onToggle).not.toHaveBeenCalled() // 只切段，不切视图
    click(tabs()[2]) // 处理
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('未启用书库时只有「设置 · 处理」两段', () => {
    m = mount(<UnifiedStatusBar currentView="config" onSelectConfigSection={vi.fn()} />)
    expect(names()).toEqual(['设置', '处理'])
    expect(selected()).toEqual(['设置'])
  })

  it('处理视图里同样显示三段，当前停在「处理」；点当前段无动作', () => {
    const onToggle = vi.fn()
    m = mount(<UnifiedStatusBar currentView="processing" configSections configSection="process" onSelectConfigSection={vi.fn()} onToggleView={onToggle} />)
    expect(names()).toEqual(['书库', '设置', '处理'])
    expect(selected()).toEqual(['处理'])
    click(tabs()[2])
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('从处理视图点「书库」：先切到书库这一段、再回配置页（没在跑，不弹确认）', () => {
    const onSelect = vi.fn()
    const onToggle = vi.fn()
    m = mount(<UnifiedStatusBar currentView="processing" configSections configSection="process" onSelectConfigSection={onSelect} onToggleView={onToggle} onAbortToConfig={vi.fn()} />)
    click(tabs()[0])
    expect(onSelect).toHaveBeenCalledWith('library')
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})
