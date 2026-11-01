import i18n from '../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, stubDomForRadix, type Mounted } from './uiTestUtils'
import {
  adjacentChapter,
  cycleTab,
  filterCommands,
  loadResume,
  resolveResume,
  resumeKeyOf,
  saveResume,
  type Command,
} from '../src/reading/commands'
import { useReadingCommands } from '../src/components/workspace/useReadingCommands'
import type { CompanionTab } from '../src/stores/readingFocus'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

const cmd = (id: string, label: string, keywords?: string): Command => ({ id, group: 'chapter', label, keywords, run: () => {} })

describe('filterCommands', () => {
  const items = [cmd('a', '第二章 转折'), cmd('b', 'KKR', 'Kohlberg Kravis Roberts 杠杆收购'), cmd('c', '收购的细节'), cmd('d', '第一章 起点')]
  it('空查询原序；前缀 > 包含 > 关键词；多词须全部命中；大小写与空白不敏感', () => {
    expect(filterCommands(items, '').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(filterCommands(items, '收购').map((c) => c.id)).toEqual(['c', 'b']) // c 前缀，b 仅关键词
    expect(filterCommands(items, 'kkr').map((c) => c.id)).toEqual(['b'])
    expect(filterCommands(items, 'kohlberg 杠杆').map((c) => c.id)).toEqual(['b'])
    expect(filterCommands(items, 'kohlberg 不存在')).toEqual([])
    expect(filterCommands(items, '第 一 章').map((c) => c.id)).toEqual(['d'])
  })
  it('limit 生效', () => {
    expect(filterCommands(items, '', 2)).toHaveLength(2)
  })
})

describe('adjacentChapter / cycleTab', () => {
  it('到头不循环；当前不在列表里时 j 去第一章、k 无处可去', () => {
    const ids = ['a', 'b', 'c']
    expect(adjacentChapter(ids, 'b', 1)).toBe('c')
    expect(adjacentChapter(ids, 'c', 1)).toBeNull()
    expect(adjacentChapter(ids, 'a', -1)).toBeNull()
    expect(adjacentChapter(ids, 'zz', 1)).toBe('a')
    expect(adjacentChapter(ids, 'zz', -1)).toBeNull()
  })
  it('页签循环切换，空列表返回 null', () => {
    expect(cycleTab(['x', 'y', 'z'], 'z', 1)).toBe('x')
    expect(cycleTab(['x', 'y', 'z'], 'x', -1)).toBe('z')
    expect(cycleTab([], 'x', 1)).toBeNull()
  })
})

describe('续读存档', () => {
  it('往返无损；坏数据 / 存储抛错一律当没有', () => {
    const store: Record<string, string> = {}
    const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const key = resumeKeyOf({ title: '书', author: '甲' })
    saveResume(key, { chapterId: 'c3', chapterIndex: 2, chapterTitle: '第三章', at: 5 }, storage)
    expect(loadResume(key, storage)).toEqual({ chapterId: 'c3', chapterIndex: 2, chapterTitle: '第三章', at: 5 })
    store[key] = '{坏'
    expect(loadResume(key, storage)).toBeNull()
    store[key] = JSON.stringify({ chapterId: 1 })
    expect(loadResume(key, storage)).toBeNull()
    expect(() => saveResume(key, { chapterId: 'x', chapterIndex: 0, chapterTitle: '', at: 0 }, { setItem: () => { throw new Error('quota') } })).not.toThrow()
    expect(loadResume(key, { getItem: () => { throw new Error('denied') } })).toBeNull()
  })
  it('resolveResume：重新加载后 id 变了也能按标题找回；找不到 null', () => {
    const p = { chapterId: 'old-2', chapterIndex: 2, chapterTitle: '第三章 终局', at: 1 }
    expect(resolveResume(p, [{ id: 'n0', title: '第一章' }, { id: 'n1', title: '第二章' }, { id: 'n2', title: '第三章：终局' }])).toBe('n2')
    expect(resolveResume(p, [{ id: 'n0', title: '别的' }])).toBeNull()
    expect(resolveResume(null, [])).toBeNull()
  })
})

describe('useReadingCommands（快捷键 / 命令面板 / 续读）', () => {
  let m: Mounted | null = null
  const chapters = [
    { id: 'c1', title: '第一章 起点', summary: '一' },
    { id: 'c2', title: '第二章 转折', summary: '二' },
    { id: 'c3', title: '第三章 终局', summary: '三' },
  ]
  const tabs = [{ id: 'graph' as CompanionTab, label: '图谱' }, { id: 'notes' as CompanionTab, label: '笔记' }]
  const book = { title: '续读测试书', author: '甲' }
  const nav = vi.fn()
  const expand = vi.fn()
  const openTab = vi.fn()
  const focus = vi.fn()

  function Harness(props: { current?: string; processing?: boolean; bare?: boolean; fresh?: boolean }) {
    const { overlay } = useReadingCommands({
      book,
      chapters: props.bare ? chapters.map((c) => ({ ...c, summary: undefined })) : props.fresh ? chapters.map((c) => ({ ...c })) : chapters,
      processing: props.processing ?? false,
      currentChapterId: props.current ?? 'c1',
      navigateChapter: nav,
      expandChapter: expand,
      tabs,
      activeTab: 'graph',
      openTab,
      linking: null,
      toggleFocusMode: focus,
    })
    return <>{overlay}</>
  }
  const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
    act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))

  beforeEach(() => {
    stubDomForRadix()
    localStorage.clear()
    vi.clearAllMocks()
  })
  afterEach(() => {
    m?.unmount()
    m = null
    document.body.innerHTML = ''
  })

  it('j / k 切章（先展开再跳）；到头不动；输入框里不触发', () => {
    m = mount(<Harness current="c2" />)
    key('j')
    expect(expand).toHaveBeenCalledWith('c3')
    expect(nav).toHaveBeenCalledWith('c3')
    key('k')
    expect(nav).toHaveBeenLastCalledWith('c1')
    nav.mockClear()
    m.rerender(<Harness current="c3" />)
    key('j')
    expect(nav).not.toHaveBeenCalled()
    const input = document.createElement('input')
    document.body.appendChild(input)
    m.rerender(<Harness current="c2" />)
    key('j', {}, input)
    expect(nav).not.toHaveBeenCalled()
  })

  it('[ ] 切页签；? 打开帮助；Ctrl+K 打开命令面板并可按回车执行首项', async () => {
    m = mount(<Harness />)
    key(']')
    expect(openTab).toHaveBeenCalledWith('notes')
    key('?')
    expect(document.body.textContent).toContain('快捷键')
    key('Escape')
    key('k', { ctrlKey: true })
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(input).not.toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '转折')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    expect(nav).toHaveBeenCalledWith('c2')
  })

  it('续读：有存档就跳回上次的章节（只一次）；没有存档、或已在存档章节则不动；处理中不恢复', async () => {
    saveResume(resumeKeyOf(book), { chapterId: 'c3', chapterIndex: 2, chapterTitle: '第三章 终局', at: 1 })
    m = mount(<Harness processing />)
    expect(nav).not.toHaveBeenCalled()
    m.rerender(<Harness />)
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('c3')
    // 章节数组换了新引用（如历史刷新）也不会再恢复一次，否则用户翻到别处会被拽回去
    m.rerender(<Harness current="c1" fresh />)
    m.rerender(<Harness current="c1" fresh />)
    expect(nav).toHaveBeenCalledTimes(1)
  })

  it('续读：章节还没有可用总结（尚未恢复）时不保存，旧存档不被覆盖', async () => {
    saveResume(resumeKeyOf(book), { chapterId: 'c3', chapterIndex: 2, chapterTitle: '第三章 终局', at: 1 })
    m = mount(<Harness bare current="c1" />)
    await act(async () => void (await new Promise((r) => setTimeout(r, 700))))
    expect(loadResume(resumeKeyOf(book))?.chapterId).toBe('c3')
  })

  it('续读：阅读位置变化 600ms 后写入存档；恢复完成前不覆盖旧存档', async () => {
    m = mount(<Harness current="c2" />)
    await act(async () => void (await new Promise((r) => setTimeout(r, 700))))
    expect(loadResume(resumeKeyOf(book))).toMatchObject({ chapterId: 'c2', chapterIndex: 1, chapterTitle: '第二章 转折' })
  })
})
