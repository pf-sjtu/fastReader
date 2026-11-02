import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, flush, click } from '../uiTestUtils'
import { StageNav } from '@/components/app/StageNav'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8')

describe('工作台顶部：导航下沉到正文列', () => {
  it('StageNav 渲染三阶段分段，当前段高亮', () => {
    m = mount(<StageNav currentView="processing" configSections onSelectConfigSection={vi.fn()} />)
    const tabs = m.container.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(3)
    expect(tabs[2].getAttribute('aria-selected')).toBe('true') // 当前停在「处理」
    expect(tabs[0].getAttribute('aria-label')).toBeTruthy()
  })

  it('未启用书库时只有「设置 / 处理」两段', () => {
    m = mount(<StageNav currentView="config" configSections={false} />)
    expect(m.container.querySelectorAll('[role="tab"]').length).toBe(2)
  })

  it('在结果视图点「设置」会要求先中止处理（弹确认框）', async () => {
    const onSelect = vi.fn()
    m = mount(
      <StageNav
        currentView="processing"
        processing
        configSections={false}
        onSelectConfigSection={onSelect}
        onAbortToConfig={vi.fn()}
      />,
    )
    const settings = m.container.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement
    await act(async () => {
      click(settings)
      await flush()
    })
    // 确认框出现前不直接切段
    expect(onSelect).not.toHaveBeenCalled()
    const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]')
    expect(dialog).toBeTruthy()
  })

  it('结果视图里点「处理」直接切回，不再确认', async () => {
    const onToggle = vi.fn()
    m = mount(
      <StageNav currentView="config" configSections={false} onToggleView={onToggle} onSelectConfigSection={vi.fn()} />,
    )
    const processing = m.container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement
    await act(async () => {
      click(processing)
      await flush()
    })
    expect(onToggle).toHaveBeenCalled()
  })

  it('正文列顶部只有一处深度切换：工作台不再渲染 DepthSwitch（右栏速读面板保留）', () => {
    const workspace = src('src/components/workspace/ReaderWorkspace.tsx')
    const studyPanel = src('src/components/study/StudyKitPanel.tsx')
    expect(workspace).not.toContain('DepthSwitch')
    expect(studyPanel).toContain('DepthSwitch')
  })

  it('顶栏只留「总结 / 模型」，导航与进度经 topNav / topStatus 下沉', () => {
    const app = src('src/App.tsx')
    expect(app).toContain('topNav={workspaceTopNav}')
    expect(app).toContain('topStatus={workspaceTopStatus}')
    expect(app).toContain('variant="meta"')
    // 经典布局仍用整条状态栏
    expect(app).toContain('<UnifiedStatusBar {...statusBarProps} />')
  })

  it('工作台顶栏不再直接渲染 status-nav（避免导航出现两次）', () => {
    const app = src('src/App.tsx')
    // 顶栏 children 里不应再有 statusBar 整条
    const headerBlock = app.slice(app.indexOf('<AppHeader compact'), app.indexOf('</AppHeader>'))
    expect(headerBlock).not.toContain('{statusBar}')
  })
})
