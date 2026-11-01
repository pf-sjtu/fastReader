/**
 * 上传卡的三块新界面：处理模式选择卡（radiogroup）、支持拖拽的落笔区、悬浮卡的进度条与「还有内容」渐隐。
 * 布局与滚动由 tests/tour/uiDemo 在真实浏览器里验收；这里守的是行为与语义。
 */
import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { act } from 'react'
import { mount, click, type Mounted } from '../uiTestUtils'
import { ProcessingModePicker } from '@/components/sections/ProcessingModePicker'
import { FileDropZone } from '@/components/sections/FileDropZone'
import { BookTooltipBody } from '@/components/library/BookInfo'
import type { LibraryEntry } from '@/services/library/types'

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

const radios = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'))

describe('处理模式选择卡', () => {
  it('三张卡是单选组：选中项 aria-checked、只有它在 Tab 序里；点击切换', () => {
    const onChange = vi.fn()
    m = mount(<ProcessingModePicker value="mindmap" onChange={onChange} />)
    expect(document.querySelector('[role="radiogroup"]')).toBeTruthy()
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1])
    for (const [i, key] of ['summaryMode', 'mindmapMode', 'combinedMindmapMode'].entries()) {
      expect(radios()[i].textContent).toContain(i18n.t(`config.${key}`))
      expect(radios()[i].textContent).toContain(i18n.t(`config.${key}Desc`)) // 每张卡一句话说明差别
    }
    click(radios()[2])
    expect(onChange).toHaveBeenCalledWith('combined-mindmap')
  })

  it('←/→ 在三张之间循环移动并选中；处理中整组禁用', () => {
    const onChange = vi.fn()
    m = mount(<ProcessingModePicker value="summary" onChange={onChange} />)
    const key = (el: HTMLElement, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
    key(radios()[0], 'ArrowLeft') // 第一张往左 → 绕到最后一张
    expect(onChange).toHaveBeenLastCalledWith('combined-mindmap')
    key(radios()[0], 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('mindmap')
    m.unmount()
    m = mount(<ProcessingModePicker value="summary" onChange={onChange} disabled />)
    expect(radios().every((r) => (r as HTMLButtonElement).disabled)).toBe(true)
  })
})

describe('落笔区', () => {
  const dropEvent = (type: string, file?: File) => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: file ? [file] : [], dropEffect: '' } })
    return ev
  }
  const zone = () => document.querySelector<HTMLElement>('[data-slot="file-drop-zone"]')!
  const base = { onPickLocal: vi.fn(), onOpenWebDAV: vi.fn() }

  it('空态邀请拖入；有书时显示书名与「格式 · 体积」', () => {
    m = mount(<FileDropZone file={null} disabled={false} onDropFile={vi.fn()} {...base} />)
    expect(zone().textContent).toContain(i18n.t('upload.dropHere')) // 空态是邀请，不是一句「未选择文件」
    expect(zone().querySelector('.sr-only')?.textContent).toContain(i18n.t('upload.noFileSelected')) // 读屏仍能听到当前没有文件
    expect(zone().textContent).toContain(i18n.t('upload.dropFormats'))
    m.unmount()
    m = mount(<FileDropZone file={new File([new Uint8Array(2048)], '穷查理宝典.epub')} disabled={false} onDropFile={vi.fn()} {...base} />)
    expect(zone().textContent).toContain('穷查理宝典.epub')
    expect(zone().textContent).toContain('EPUB · 2 KB')
  })

  it('拖入时出现「松开即可载入」，放下后把文件交给 onDropFile 并复位', () => {
    const onDropFile = vi.fn()
    m = mount(<FileDropZone file={null} disabled={false} onDropFile={onDropFile} {...base} />)
    const f = new File(['x'], 'a.epub')
    act(() => void zone().dispatchEvent(dropEvent('dragenter', f)))
    expect(zone().dataset.dragging).toBeDefined()
    expect(zone().textContent).toContain(i18n.t('upload.dropRelease'))
    act(() => void zone().dispatchEvent(dropEvent('drop', f)))
    expect(onDropFile).toHaveBeenCalledWith(f)
    expect(zone().dataset.dragging).toBeUndefined()
  })

  it('处理中不接收拖入；拖的不是文件（比如选中的文字）也不响应', () => {
    const onDropFile = vi.fn()
    m = mount(<FileDropZone file={null} disabled onDropFile={onDropFile} {...base} />)
    act(() => void zone().dispatchEvent(dropEvent('dragenter', new File(['x'], 'a.epub'))))
    expect(zone().dataset.dragging).toBeUndefined()
    act(() => void zone().dispatchEvent(dropEvent('drop', new File(['x'], 'a.epub'))))
    expect(onDropFile).not.toHaveBeenCalled()
    m.unmount()
    m = mount(<FileDropZone file={null} disabled={false} onDropFile={onDropFile} {...base} />)
    const text = new Event('dragenter', { bubbles: true, cancelable: true })
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'], files: [] } })
    act(() => void zone().dispatchEvent(text))
    expect(zone().dataset.dragging).toBeUndefined()
  })
})

describe('悬浮卡：阅读进度与渐隐提示', () => {
  const entry = { path: 'a.epub', title: 'A', size: 1, mtime: '', status: 'unprocessed', stale: false, missingScans: 0, updatedAt: 0, readProgress: { pct: 37 } } as unknown as LibraryEntry

  it('读到一半的书画出进度条（aria 值正确）；没读或读完不画', () => {
    m = mount(<BookTooltipBody entry={entry} />)
    const bar = document.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('37')
    m.unmount()
    for (const pct of [0, 100]) {
      m = mount(<BookTooltipBody entry={{ ...entry, readProgress: { pct } } as unknown as LibraryEntry} />)
      expect(document.querySelector('[role="progressbar"]')).toBeNull()
      m.unmount()
    }
    m = null
  })

  it('内容没超出时不渐隐；超出（还有内容）时底边渐隐，滚到底后消失', () => {
    m = mount(<BookTooltipBody entry={entry} />)
    const el = m.container.firstElementChild as HTMLElement
    expect(el.style.maskImage).toBe('') // jsdom 没有布局：scrollHeight = clientHeight = 0 → 没有「还有」
    const dim = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
      el.scrollTop = scrollTop
      act(() => void el.dispatchEvent(new Event('scroll', { bubbles: true })))
    }
    dim(500, 300, 0)
    expect(el.style.maskImage).toContain('linear-gradient')
    dim(500, 300, 200) // 已到底
    expect(el.style.maskImage).toBe('')
  })
})
