import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, click } from './uiTestUtils'
import { ListRow } from '@/components/ui/list-row'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

describe('ListRow 可交互语义', () => {
  it('role=checkbox 的 div 行：aria-checked 跟随 selected、可聚焦、Enter / 空格触发、点击触发', () => {
    const onClick = vi.fn()
    m = mount(<ListRow role="checkbox" selected title="书.epub" onClick={onClick} />)
    const row = document.querySelector('[role=checkbox]') as HTMLElement
    expect(row.tagName).toBe('DIV')
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(row.tabIndex).toBe(0)
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(onClick).toHaveBeenCalledTimes(2)
    click(row)
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('未选中时 aria-checked=false；role=button 的目录行不带 aria-checked', () => {
    m = mount(
      <>
        <ListRow role="checkbox" title="a" onClick={() => {}} />
        <ListRow role="button" title="目录" onClick={() => {}} />
      </>
    )
    expect(document.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[role=button]')?.hasAttribute('aria-checked')).toBe(false)
  })

  it('不给 role 时行为不变：可点即 button 语义，不可点是 div', () => {
    m = mount(
      <>
        <ListRow title="可点" onClick={() => {}} />
        <ListRow title="静态" />
      </>
    )
    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(document.querySelectorAll('div[role]')).toHaveLength(0)
  })
})
