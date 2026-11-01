/**
 * 用上云端 metadata 的书架交互：分类条、详情对话框、「WebDAV 上找不到」的两类提示与确认。
 */
import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, findButton, typeInto } from '../uiTestUtils'

vi.mock('@/services/webdavService', () => ({
  webdavService: { downloadFileAsFile: vi.fn(), existsStatus: vi.fn(), isInitialized: () => false, onInitialized: () => () => {} },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { LibraryView } from '@/components/library/LibraryView'
import { useLibraryStore } from '@/services/library/libraryStore'
import { useConfigStore } from '@/stores/configStore'
import { bookIdOf } from '@/services/library/bookId'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'
import type { CoverIndex } from '@/services/library/cloudCovers'
import type { LibraryEntry } from '@/services/library/types'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const real = (...names: string[]) =>
  applyScan(emptyIndex(0), names.map((n) => ({ path: `/s/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index

/** 云端书目：6 本，分类 Business×3 / History×2 / Art×1 */
const idOf = (stem: string) => bookIdOf(`${stem}.epub`) // 真实 id 是书名主干的哈希：WebDAV 上的同名文件才能精确配上
const catalog = (): CoverIndex => ({
  [idOf('商业一')]: { stem: '商业一', title: '商业一', file: '商业一.epub', author: '作者甲', subjects: ['Business', 'History'], publisher: '中信出版社', year: 2020, desc: '这是一本讲述拿破仑与金融危机的书。', chapterCount: 12, size: 3_145_728, cover: 1 },
  [idOf('商业二')]: { stem: '商业二', title: '商业二', file: '商业二.epub', subjects: ['Business'], year: 2018 },
  [idOf('商业三')]: { stem: '商业三', title: '商业三', file: '商业三.epub', subjects: ['Business'] },
  [idOf('历史一')]: { stem: '历史一', title: '历史一', file: '历史一.epub', subjects: ['History'] },
  [idOf('艺术一')]: { stem: '艺术一', title: '艺术一', file: '艺术一.epub', subjects: ['Art'] },
  [idOf('无标签')]: { stem: '无标签', title: '无标签', file: '无标签.epub' },
})

const cards = () => Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button[data-book-card]'))
const names = () => cards().map((c) => c.getAttribute('aria-label')!.split('，')[0]).sort()
const chip = (text: string) =>
  Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find((b) => b.textContent?.startsWith(text))

beforeEach(() => {
  useConfigStore.getState().setWebDAVEnabled(true)
  useLibraryStore.setState({
    index: emptyIndex(0),
    catalog: catalog(),
    catalogLoaded: true,
    refreshing: false,
    fresh: false,
    error: null,
    unavailable: false,
    missing: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    loadCatalog: vi.fn().mockResolvedValue(undefined),
    loadMirror: vi.fn().mockResolvedValue(undefined),
    removeBooks: vi.fn().mockResolvedValue(1),
    askRemove: vi.fn((m: LibraryEntry | null) => useLibraryStore.setState({ missing: m })),
  })
})

describe('分类条', () => {
  it('只靠云端书目（WebDAV 未连接）就能列出分类及书数，数量降序', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const labels = Array.from(mounted.container.querySelectorAll('[role="group"] button')).map((b) => b.textContent)
    expect(labels).toEqual(['全部分类', '商业 · 3', '历史 · 2', '艺术 · 1'])
  })

  it('点分类只显示该类的书（含多标签书的次要分类）；再点一次取消；「全部分类」清除', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(chip('历史'))
    expect(chip('历史')!.getAttribute('aria-pressed')).toBe('true')
    expect(names()).toEqual(['历史一', '商业一'].sort())
    click(chip('历史'))
    expect(chip('历史')!.getAttribute('aria-pressed')).toBe('false')
    click(chip('艺术'))
    expect(names()).toEqual(['艺术一'])
    click(chip('全部分类'))
    expect(chip('全部分类')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('选了分类后不再有「推荐 / 继续阅读」分区，直接是筛选结果；分类下没有匹配时给出提示', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(chip('商业'))
    expect(mounted.container.textContent).not.toContain('随机推荐')
    typeInto(mounted.container.querySelector('input')!, '完全不存在')
    expect(mounted.container.textContent).toContain('没有符合条件的书')
  })

  it('分类很多时只直接摆前 8 个，其余收进「更多分类」；选中的冷门分类仍以 chip 可见', () => {
    const many: CoverIndex = {}
    for (let i = 0; i < 12; i++) many[`bk_${String(i).padStart(6, 'a')}`] = { stem: `书${i}`, title: `书${i}`, file: `书${i}.epub`, subjects: [`类${String(i).padStart(2, '0')}`] }
    useLibraryStore.setState({ catalog: many })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.querySelectorAll('[role="group"] button[aria-pressed]')).toHaveLength(1 + 8)
    const more = mounted.container.querySelector<HTMLSelectElement>('select[aria-label="更多分类"]')!
    expect(more.options).toHaveLength(1 + 4)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(more, '类11')
      more.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(chip('类11')?.getAttribute('aria-pressed')).toBe('true')
    expect(names()).toEqual(['书11'])
  })

  it('没有任何分类数据（老书、PDF）时不显示分类条', () => {
    useLibraryStore.setState({ catalog: { bk_aaaaaa: { stem: '甲', title: '甲', file: '甲.pdf' } } })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.querySelector('[role="group"]')).toBeNull()
  })

  it('搜索也覆盖简介 / 出版社 / 分类', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    typeInto(mounted.container.querySelector('input')!, '拿破仑')
    expect(names()).toEqual(['商业一'])
    typeInto(mounted.container.querySelector('input')!, '中信')
    expect(names()).toEqual(['商业一'])
  })
})

describe('详情对话框', () => {
  const openInfo = (title: string) => {
    const btn = Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === `查看详情：${title}`)
    click(btn)
  }

  it('每张卡都有独立的详情入口（与打开按钮是兄弟节点，不是按钮套按钮）', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.querySelectorAll('button button')).toHaveLength(0)
    expect(mounted.container.querySelectorAll('button[aria-label^="查看详情"]').length).toBeGreaterThan(0)
  })

  it('展示出版社 / 年份 / 章数 / 大小 / 简介 / 分类；不在每本书上重复解释数据来源', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(chip('商业'))
    openInfo('商业一')
    const text = document.body.textContent ?? ''
    for (const s of ['商业一', '作者甲', '中信出版社', '2020', '12 章', '3.0 MB', '拿破仑与金融危机', '商业', '历史']) expect(text, s).toContain(s)
    // 数据来源只在书架顶部说一次，不在每本书的详情里重复
    const dialog = document.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(dialog).toContain('商业一')
    expect(dialog).not.toContain('WebDAV')
    expect(dialog).not.toContain('来自云端书目')
  })

  it('悬浮卡内容同样不带数据来源提示（虚拟条目也是）', async () => {
    const { BookTooltipBody } = await import('@/components/library/BookInfo')
    const virtual = { path: 'cloud://x/a.epub', title: 'A', size: 0, mtime: '', status: 'unprocessed', stale: false, missingScans: 0, updatedAt: 0, virtual: true } as LibraryEntry
    mounted = mount(<BookTooltipBody entry={virtual} />)
    expect(mounted.container.textContent).toContain('A')
    expect(mounted.container.textContent).not.toContain('WebDAV')
  })

  it('没有简介的书写明「没有简介」而不是留空', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(chip('艺术'))
    openInfo('艺术一')
    expect(document.body.textContent).toContain('这本书没有简介')
  })

  it('点对话框里的分类标签：关闭对话框并回到书架按该分类筛选', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(chip('商业'))
    openInfo('商业一')
    click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] ul button')).find((b) => b.textContent === '历史'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(chip('历史')!.getAttribute('aria-pressed')).toBe('true')
    expect(chip('商业')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('「打开这本书」回调该条目并关闭对话框；正在打开别的书时禁用', () => {
    const onOpen = vi.fn()
    mounted = mount(<LibraryView onOpenBook={onOpen} />)
    click(chip('商业'))
    openInfo('商业一')
    click(findButton('打开这本书'))
    expect((onOpen.mock.calls[0][0] as LibraryEntry).title).toBe('商业一')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    mounted.rerender(<LibraryView onOpenBook={onOpen} openingPath="/x" />)
    openInfo('商业一')
    expect(findButton('打开这本书')!.disabled).toBe(true)
  })
})

describe('云端有、WebDAV 没有：整批提示（只有一次成功扫描之后才可信）', () => {
  const notice = () => Array.from(mounted!.container.querySelectorAll('[role="status"]')).find((e) => e.textContent?.includes('在 WebDAV 上找不到'))

  it('扫描成功且扫到了书：提示云端多出来的书数；点「查看并清理」列出并确认后才删除', async () => {
    useLibraryStore.setState({ index: real('商业一.epub', '商业二.epub'), fresh: true }) // 云端 6 本，WebDAV 有 2 本
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(notice()?.textContent).toContain('4 本')
    expect(useLibraryStore.getState().removeBooks).not.toHaveBeenCalled()
    click(findButton(/查看并清理/))
    expect(document.body.textContent).toContain('清理 4 条云端资料')
    expect(document.body.textContent).toContain('不会动 WebDAV 上的文件')
    await act(async () => {
      findButton('全部删除')!.click()
    })
    const removed = (useLibraryStore.getState().removeBooks as ReturnType<typeof vi.fn>).mock.calls[0][0] as LibraryEntry[]
    expect(removed.map((e) => e.title).sort()).toEqual(['历史一', '无标签', '艺术一', '商业三'].sort())
    expect(removed.every((e) => e.virtual)).toBe(true) // 只会删虚拟条目，WebDAV 上存在的书不在其列
  })

  it('选「保留」不删除', () => {
    useLibraryStore.setState({ index: real('商业一.epub'), fresh: true })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(findButton(/查看并清理/))
    click(findButton('保留'))
    expect(useLibraryStore.getState().removeBooks).not.toHaveBeenCalled()
  })

  it('本会话还没成功扫描过（fresh=false）：不提示——否则一开始 WebDAV 还没读就会说全部书都找不到', () => {
    useLibraryStore.setState({ index: real('商业一.epub'), fresh: false })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(notice()).toBeUndefined()
  })

  it('扫描「成功」但一本书都没扫到（多半目录配错）：不提示，避免诱导用户清空云端书目', () => {
    useLibraryStore.setState({ index: emptyIndex(0), fresh: true })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(notice()).toBeUndefined()
  })

  it('刷新进行中不提示（结果还没定）', () => {
    useLibraryStore.setState({ index: real('商业一.epub'), fresh: true, refreshing: true })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(notice()).toBeUndefined()
  })

  it('云端书目与 WebDAV 完全对得上：没有任何提示', () => {
    useLibraryStore.setState({ index: real('商业一.epub', '商业二.epub', '商业三.epub', '历史一.epub', '艺术一.epub', '无标签.epub'), fresh: true })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(notice()).toBeUndefined()
  })
})

describe('单本缺失确认（点开时发现 WebDAV 上没有）', () => {
  const missingEntry = (): LibraryEntry => ({ ...Object.values(real('商业一.epub').entries)[0], catalogId: idOf('商业一') })

  it('没有待确认项时不显示对话框', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('说明原因，并强调只删云端资料、不碰 WebDAV 文件；确认后删除这一本', async () => {
    useLibraryStore.setState({ missing: missingEntry() })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const text = document.querySelector('[role="alertdialog"]')?.textContent ?? ''
    expect(text).toContain('WebDAV 上找不到《商业一》')
    expect(text).toContain('不会影响 WebDAV 上的任何文件')
    await act(async () => {
      findButton('删除资料')!.click()
    })
    const arg = (useLibraryStore.getState().removeBooks as ReturnType<typeof vi.fn>).mock.calls[0][0] as LibraryEntry[]
    expect(arg).toHaveLength(1)
    expect(arg[0].catalogId).toBe(idOf('商业一'))
  })

  it('选「保留」：清除待确认项且不删除', () => {
    useLibraryStore.setState({ missing: missingEntry() })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    click(findButton('保留'))
    expect(useLibraryStore.getState().askRemove).toHaveBeenCalledWith(null)
    expect(useLibraryStore.getState().removeBooks).not.toHaveBeenCalled()
  })
})
