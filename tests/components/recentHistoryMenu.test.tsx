import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act } from 'react'
import { mount, flush } from '../uiTestUtils'
import { RecentHistoryMenu, RECENT_MENU_LIMIT } from '@/components/RecentHistoryMenu'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

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

const rec = (n: number): ProcessingHistoryRecord => ({
  bookTitle: n === 1 ? '门口的野蛮人：史上最强悍的资本收购' : `书${n}`,
  fileName: `书${n}.epub`,
  completedAt: '2026-10-3' + (n % 10) + 'T08:00:00Z',
  processingMode: 'summary',
  model: 'm',
  chapterCount: 10 + n,
})
const records = (n: number) => Array.from({ length: n }, (_, i) => rec(i + 1))

/** Radix 触发器：键盘 Enter 打开（jsdom 下比 pointer 事件稳定） */
const openMenu = async () => {
  const trigger = m!.container.querySelector('button')!
  act(() => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await flush()
}
const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))

describe('RecentHistoryMenu', () => {
  it('没有记录时不渲染', () => {
    m = mount(<RecentHistoryMenu records={[]} loadingFileName={null} onSelect={() => {}} onViewAll={() => {}} />)
    expect(m.container.innerHTML).toBe('')
  })

  it('触发器显示「最近处理」+最新一本的书名；打开后每本一行，完整书名、模式·章数·日期都在', async () => {
    m = mount(<RecentHistoryMenu records={records(3)} loadingFileName={null} onSelect={() => {}} onViewAll={() => {}} />)
    expect(m.container.textContent).toContain('最近处理')
    expect(m.container.textContent).toContain('门口的野蛮人')
    await openMenu()
    const rows = items()
    expect(rows).toHaveLength(3 + 1) // 3 本 + 查看全部
    expect(rows[0].textContent).toContain('门口的野蛮人：史上最强悍的资本收购') // 不被截断成「…」
    expect(rows[0].textContent).toContain('文字总结')
    expect(rows[0].textContent).toContain('11章')
    // 书名行允许换行，不能再带 truncate（旧版把每条截到 120px）
    expect(rows[0].querySelector('.truncate')).toBeNull()
  })

  it('点一本触发 onSelect（带整条记录）；「查看全部」始终存在，并带总数', async () => {
    const onSelect = vi.fn()
    const onViewAll = vi.fn()
    m = mount(<RecentHistoryMenu records={records(2)} loadingFileName={null} onSelect={onSelect} onViewAll={onViewAll} />)
    await openMenu()
    act(() => items()[1].click())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ fileName: '书2.epub' }))

    await openMenu()
    const viewAll = items().find((e) => e.textContent?.includes('查看全部'))!
    expect(viewAll.textContent).toContain('2')
    act(() => viewAll.click())
    expect(onViewAll).toHaveBeenCalledTimes(1)
  })

  it(`记录多于 ${RECENT_MENU_LIMIT} 条：只列前 ${RECENT_MENU_LIMIT} 条，总数写在「查看全部」里`, async () => {
    m = mount(<RecentHistoryMenu records={records(9)} loadingFileName={null} onSelect={() => {}} onViewAll={() => {}} />)
    await openMenu()
    expect(items()).toHaveLength(RECENT_MENU_LIMIT + 1)
    expect(items().at(-1)!.textContent).toContain('9')
  })

  it('加载某本时触发器禁用，避免重复点击', () => {
    m = mount(<RecentHistoryMenu records={records(2)} loadingFileName="书1.epub" onSelect={() => {}} onViewAll={() => {}} />)
    expect(m.container.querySelector('button')!.disabled).toBe(true)
  })
})
