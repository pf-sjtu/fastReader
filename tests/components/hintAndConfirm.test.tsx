import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, flush, click } from '../uiTestUtils'
import { Hint } from '@/components/ui/hint'
import { StatusProgress } from '@/components/UnifiedStatusBar'

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

describe('Hint 的色调不能丢', () => {
  it('无框的错误态必须是危险色，不能退回灰字', () => {
    m = mount(<Hint tone="danger">出错了</Hint>)
    const el = m.container.querySelector('[data-slot="hint"]') as HTMLElement
    expect(el.className).toMatch(/text-destructive/)
    expect(el.className).not.toMatch(/text-muted-foreground/)
  })

  it('无框的警告 / 成功 / 信息态各用自己的颜色', () => {
    for (const [tone, cls] of [
      ['warning', 'text-warning'],
      ['success', 'text-success'],
      ['info', 'text-info'],
    ] as const) {
      m = mount(<Hint tone={tone}>提示</Hint>)
      const el = m.container.querySelector('[data-slot="hint"]') as HTMLElement
      expect(el.className, tone).toMatch(new RegExp(cls))
      m?.unmount()
      m = null
    }
  })

  it('无框的中性态仍是灰字', () => {
    m = mount(<Hint tone="neutral">旁注</Hint>)
    const el = m.container.querySelector('[data-slot="hint"]') as HTMLElement
    expect(el.className).toMatch(/text-muted-foreground/)
  })

  it('带框态有淡底与描边', () => {
    m = mount(<Hint tone="danger" boxed>出错了</Hint>)
    const el = m.container.querySelector('[data-slot="hint"]') as HTMLElement
    expect(el.className).toMatch(/bg-destructive-muted/)
    expect(el.className).toMatch(/border-destructive-border/)
  })

  it('错误态用 alert，其余用 status，中性不加 role', () => {
    m = mount(<Hint tone="danger">错了</Hint>)
    expect(m.container.querySelector('[role="alert"]')).toBeTruthy()
    m?.unmount()
    m = null
    m = mount(<Hint tone="success">好了</Hint>)
    expect(m.container.querySelector('[role="status"]')).toBeTruthy()
    m?.unmount()
    m = null
    m = mount(<Hint tone="neutral">旁注</Hint>)
    expect(m.container.querySelector('[role]')).toBeFalsy()
  })
})

describe('处理中的破坏性操作都要二次确认', () => {
  const props = {
    currentView: 'processing' as const,
    processing: true,
    progress: 40,
    currentStep: '处理中',
    onCancelProcessing: vi.fn(),
    onAbortToConfig: vi.fn(),
  }

  it('「中止并返回配置」先弹确认，确认后才真的中止', async () => {
    const onAbortToConfig = vi.fn()
    m = mount(<StatusProgress {...props} onAbortToConfig={onAbortToConfig} />)
    // 「改设置」= progress.abortAndEditSettingsShort（注意：它与「中止」是两个字，别混淆）
    const btn = [...m.container.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === '改设置'
    ) as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => {
      click(btn)
      await flush()
    })
    // 还没确认前不动
    expect(onAbortToConfig).not.toHaveBeenCalled()
    const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]')
    expect(dialog).toBeTruthy()
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((b) =>
      /中止|确认/.test(b.textContent || '')
    ) as HTMLButtonElement
    await act(async () => {
      click(confirm)
      await flush()
    })
    expect(onAbortToConfig).toHaveBeenCalled()
  })

  it('「中止」也要二次确认', async () => {
    const onCancelProcessing = vi.fn()
    m = mount(<StatusProgress {...props} onCancelProcessing={onCancelProcessing} />)
    const btn = [...m.container.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === '中止'
    ) as HTMLButtonElement
    await act(async () => {
      click(btn)
      await flush()
    })
    expect(onCancelProcessing).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alertdialog"], [role="dialog"]')).toBeTruthy()
  })
})
