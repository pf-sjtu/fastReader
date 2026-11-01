import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { mount, click, findButton, type Mounted } from '../uiTestUtils'
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
  it('书库段：只渲染书架，不出现上传与配置卡', () => {
    m = mount(<ConfigStep {...props} book={emptyBook} section="library" />)
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

describe('顶栏的「书库 / 处理」分段', () => {
  it('配置视图且 WebDAV 启用时显示两个分段，点击会切段', () => {
    const onSelect = vi.fn()
    m = mount(
      <UnifiedStatusBar
        currentView="config"
        configSections
        configSection="library"
        onSelectConfigSection={onSelect}
      />
    )
    const libraryTab = m.container.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')
    expect(libraryTab?.textContent).toContain('书库')

    click(findButton(/^处理$/))
    expect(onSelect).toHaveBeenCalledWith('process')
  })

  it('未启用书库时不显示分段', () => {
    m = mount(<UnifiedStatusBar currentView="config" onSelectConfigSection={vi.fn()} />)
    expect(m.container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('处理视图不显示分段（结果页只保留「返回配置」）', () => {
    m = mount(
      <UnifiedStatusBar
        currentView="processing"
        configSections
        configSection="process"
        onSelectConfigSection={vi.fn()}
      />
    )
    expect(m.container.querySelector('[role="tablist"]')).toBeNull()
  })
})
