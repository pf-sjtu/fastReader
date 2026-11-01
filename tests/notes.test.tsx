import i18n from '../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, flush, type Mounted } from './uiTestUtils'
import {
  captureContext,
  groupNotes,
  makeNote,
  notesToMarkdown,
  resolveChapterIndex,
  sanitizeNotes,
  NOTES_VERSION,
  type Note,
} from '../src/notes/notes'
import { notesDeps, notesKeyOf, useNotesStore } from '../src/notes/notesStore'
import { NotesPanel } from '../src/components/notes/NotesPanel'
import { SelectionToolbar } from '../src/components/notes/SelectionToolbar'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

const chapters = [
  { id: 'c1', title: '第一章 起点', summary: '这是起点章节的总结，KKR 发起了收购。' },
  { id: 'c2', title: '第二章 转折', summary: '转折发生了。' },
]
const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1', chapterId: 'c1', chapterIndex: 0, chapterTitle: '第一章 起点', quote: 'KKR 发起了收购', prefix: '', suffix: '', comment: '', color: 1, createdAt: 1, ...over,
})

describe('notes 纯函数', () => {
  it('captureContext 取选中文字前后文；选中文字不在章节里 → 空上下文', () => {
    const ctx = captureContext('前面一段话。KKR 发起了收购。后面一段话。', 'KKR  发起了收购')
    expect(ctx.prefix).toContain('前面一段话')
    expect(ctx.suffix).toContain('后面一段话')
    expect(captureContext('abc', 'xyz')).toEqual({ prefix: '', suffix: '' })
  })

  it('makeNote：空选区返回 null；超长引用 / 批注被截断；空白折叠', () => {
    expect(makeNote({ chapterId: 'c', chapterIndex: 0, chapterTitle: 't', selected: '   ' })).toBeNull()
    const n = makeNote({ chapterId: 'c', chapterIndex: 0, chapterTitle: 't', selected: `a\n\n b ${'x'.repeat(900)}`, comment: 'y'.repeat(3000) })!
    expect(n.quote.startsWith('a b ')).toBe(true)
    expect(n.quote.length).toBe(500)
    expect(n.comment.length).toBe(2000)
  })

  it('sanitizeNotes：版本不对 → 空；坏条目、重复 id 被丢；字段被规整', () => {
    expect(sanitizeNotes(null)).toEqual([])
    expect(sanitizeNotes({ version: 99, notes: [note()] })).toEqual([])
    const out = sanitizeNotes({
      version: NOTES_VERSION,
      notes: [note(), note(), { id: 'x' }, { id: 'y', quote: '  ' }, { id: 'z', quote: 'q', color: 9, chapterIndex: 'a' }],
    })
    expect(out.map((n) => n.id)).toEqual(['n1', 'z'])
    expect(out[1]).toMatchObject({ color: 1, chapterIndex: -1, chapterId: '' })
  })

  it('resolveChapterIndex：先 id、再标题（忽略空白标点）、再序号+标题兼容；都不行 -1', () => {
    expect(resolveChapterIndex(note(), chapters)).toBe(0)
    const reloaded = [{ id: 'cloud-0', title: '第一章：起点' }, { id: 'cloud-1', title: '第二章 转折' }]
    expect(resolveChapterIndex(note(), reloaded)).toBe(0) // id 变了，标题宽松相等
    expect(resolveChapterIndex(note({ chapterId: 'zz', chapterTitle: '起点', chapterIndex: 0 }), reloaded)).toBe(0) // 序号处标题兼容
    // 章节顺序变了（序号对不上）：只能靠标题找回
    expect(resolveChapterIndex(note(), [{ id: 'k0', title: '第二章 转折' }, { id: 'k1', title: '第一章：起点' }])).toBe(1)
    expect(resolveChapterIndex(note({ chapterId: 'zz', chapterTitle: '完全无关', chapterIndex: 0 }), reloaded)).toBe(-1)
  })

  it('groupNotes：按章节顺序、组内按时间，游离笔记放最后；Markdown 导出含引用块与批注', () => {
    const notes = [
      note({ id: 'b', chapterId: 'c2', chapterTitle: '第二章 转折', chapterIndex: 1, createdAt: 5, comment: '重要' }),
      note({ id: 'a2', createdAt: 3 }),
      note({ id: 'a1', createdAt: 2 }),
      note({ id: 'o', chapterId: 'x', chapterTitle: '消失的章', chapterIndex: 9, createdAt: 1, quote: '游离\n两行' }),
    ]
    const groups = groupNotes(notes, chapters)
    expect(groups.map((g) => g.notes.map((n) => n.id))).toEqual([['a1', 'a2'], ['b'], ['o']])
    expect(groups[2].chapter).toBeNull()
    const md = notesToMarkdown('某书', groups, { orphan: '游离', untitled: '未命名' })
    expect(md).toContain('# 某书')
    expect(md).toContain('## 第二章 转折\n\n> KKR 发起了收购\n\n重要')
    expect(md).toContain('## 游离\n\n> 游离\n> 两行')
    expect(md.endsWith('\n')).toBe(true)
  })
})

describe('notesStore', () => {
  const saved: Record<string, unknown> = {}
  beforeEach(() => {
    for (const k of Object.keys(saved)) delete saved[k]
    notesDeps.backend = {
      load: async (key) => saved[key] ?? null,
      save: async (key, file) => {
        saved[key] = file
      },
    }
    useNotesStore.setState({ bookKey: null, notes: [], editingId: null })
  })

  it('bind 读取存档；add / update / remove 都写回；换书后不串', async () => {
    const key = notesKeyOf({ title: 'A', author: 'x' })
    saved[key] = { version: NOTES_VERSION, notes: [note()] }
    await useNotesStore.getState().bind(key)
    expect(useNotesStore.getState().notes).toHaveLength(1)

    useNotesStore.getState().add(note({ id: 'n2' }), { edit: true })
    expect(useNotesStore.getState().editingId).toBe('n2')
    useNotesStore.getState().update('n2', { comment: '批' })
    expect((saved[key] as { notes: Note[] }).notes.find((n) => n.id === 'n2')?.comment).toBe('批')
    useNotesStore.getState().remove('n2')
    expect(useNotesStore.getState().editingId).toBeNull()
    expect((saved[key] as { notes: Note[] }).notes).toHaveLength(1)

    await useNotesStore.getState().bind(notesKeyOf({ title: 'B' }))
    expect(useNotesStore.getState().notes).toEqual([])
    expect((saved[key] as { notes: Note[] }).notes).toHaveLength(1) // 旧书存档未被动
  })

  it('加载慢于换书：旧书的结果被丢弃，不覆盖新书', async () => {
    let release!: (v: unknown) => void
    notesDeps.backend.load = (key) => (key.includes('slow') ? new Promise((r) => (release = r)) : Promise.resolve(null))
    const p = useNotesStore.getState().bind('notes:slow|')
    await useNotesStore.getState().bind('notes:fast|')
    release({ version: NOTES_VERSION, notes: [note()] })
    await p
    expect(useNotesStore.getState().bookKey).toBe('notes:fast|')
    expect(useNotesStore.getState().notes).toEqual([])
  })

  it('存档读取失败：当作空，不抛', async () => {
    notesDeps.backend.load = async () => {
      throw new Error('idb')
    }
    await expect(useNotesStore.getState().bind('notes:x|')).resolves.toBeUndefined()
    expect(useNotesStore.getState().notes).toEqual([])
  })
})

describe('NotesPanel / SelectionToolbar', () => {
  let m: Mounted | null = null
  beforeEach(() => {
    notesDeps.backend = { load: async () => null, save: async () => {} }
    useNotesStore.setState({ bookKey: 'k', notes: [], editingId: null })
  })
  afterEach(() => {
    m?.unmount()
    m = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('空状态给引导；有笔记后列出引用与批注，点批注进入编辑，失焦保存，删除生效', async () => {
    m = mount(<NotesPanel bookTitle="书" chapters={chapters} onJumpChapter={() => {}} />)
    expect(m.container.textContent).toContain('还没有笔记')
    act(() => useNotesStore.getState().add(note({ comment: '' })))
    expect(m.container.textContent).toContain('KKR 发起了收购')
    click(Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === '添加批注'))
    const ta = m.container.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, '我的看法')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.blur()
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await flush()
    expect(useNotesStore.getState().notes[0].comment).toBe('我的看法')
    click(m.container.querySelector('button[aria-label="删除笔记"]'))
    expect(useNotesStore.getState().notes).toHaveLength(0)
  })

  it('点章节标题跳转', () => {
    const jump = vi.fn()
    useNotesStore.setState({ notes: [note()] })
    m = mount(<NotesPanel bookTitle="书" chapters={chapters} onJumpChapter={jump} />)
    click(Array.from(m.container.querySelectorAll('h3 button')).find((b) => b.textContent === '第一章 起点'))
    expect(jump).toHaveBeenCalledWith('c1')
  })

  it('选中某章正文里的文字 → 出现工具条；「批注」建笔记、进入编辑并打开笔记页签；选区在章节外不出', async () => {
    const body = document.createElement('main')
    body.innerHTML = '<div id="chapter-summary-c1"><p id="p">KKR 发起了收购</p></div><p id="outside">别处</p>'
    document.body.appendChild(body)
    const openNotes = vi.fn()
    m = mount(<SelectionToolbar bodyEl={body} chapters={chapters} onOpenNotes={openNotes} />)
    const select = (el: Element, text: string) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.getBoundingClientRect = () => ({ x: 10, y: 10, width: 50, height: 16, top: 10, left: 10, right: 60, bottom: 26, toJSON() {} }) as DOMRect
      const sel = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => text, removeAllRanges: vi.fn() }
      vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection)
    }
    select(body.querySelector('#outside')!, '别处')
    act(() => body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
    expect(document.querySelector('[role="toolbar"]')).toBeNull()

    select(body.querySelector('#p')!, 'KKR 发起了收购')
    act(() => body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
    const bar = document.querySelector('[role="toolbar"]')!
    expect(bar).not.toBeNull()
    click(Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === '批注'))
    const { notes, editingId } = useNotesStore.getState()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ chapterId: 'c1', chapterIndex: 0, quote: 'KKR 发起了收购' })
    expect(notes[0].prefix + notes[0].suffix).not.toBe('') // 前后文取到了
    expect(editingId).toBe(notes[0].id)
    expect(openNotes).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="toolbar"]')).toBeNull()
  })
})
