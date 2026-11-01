/**
 * 用上 metadata 之后的书架逻辑：分类筛选、多字段搜索、按年份排序、按分类/年份/出版社分组、同类推荐、
 * 标签翻译表与 OPF 扩展解析。
 */
import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from '../../src/i18n'
import zh from '../../src/i18n/locales/zh.json'
import en from '../../src/i18n/locales/en.json'
import { CATEGORY_KEYS, categoryLabel, groupLabel } from '@/components/library/labels'
import { parseOpfMeta } from '@/services/library/bookMeta'
import { listEntries } from '@/services/library/libraryIndex'
import { groupEntries, groupKeyOf, recommendBooks } from '@/services/library/libraryOrganize'
import type { LibraryEntry, LibraryIndex } from '@/services/library/types'

const book = (title: string, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({
  path: `/s/${title}.epub`,
  size: 1,
  mtime: 'm',
  title,
  status: 'unprocessed',
  stale: false,
  missingScans: 0,
  updatedAt: 0,
  ...extra,
})
const index = (...books: LibraryEntry[]): LibraryIndex => ({ schemaVersion: 1, updatedAt: 0, entries: Object.fromEntries(books.map((b) => [b.path, b])) })
const titles = (es: LibraryEntry[]) => es.map((e) => e.title)

const lib = index(
  book('商业甲', { subjects: ['Business', 'History'], year: 2020, publisher: '中信出版社', desc: '讲述拿破仑与金融危机的故事', author: '张三' }),
  book('历史乙', { subjects: ['History'], year: 2015, publisher: '上海译文出版社', desc: '一部通史' }),
  book('哲学丙', { subjects: ['Philosophy'], year: 2023, publisher: '中信出版社' }),
  book('无资料丁')
)

describe('listEntries：分类 / 搜索 / 年份', () => {
  it('分类筛选按任一标签命中（多标签的书在每个标签下都能找到）', () => {
    expect(titles(listEntries(lib, { category: 'History', sort: 'name' }))).toEqual(['历史乙', '商业甲'])
    expect(titles(listEntries(lib, { category: 'Philosophy' }))).toEqual(['哲学丙'])
    expect(listEntries(lib, { category: 'Nope' })).toEqual([])
    expect(listEntries(lib, { category: null })).toHaveLength(4)
  })

  it('分类与状态筛选、搜索可叠加', () => {
    const done = index(book('甲', { subjects: ['Art'], status: 'done' }), book('乙', { subjects: ['Art'] }))
    expect(titles(listEntries(done, { category: 'Art', filter: 'done' }))).toEqual(['甲'])
    expect(titles(listEntries(done, { category: 'Art', query: '乙' }))).toEqual(['乙'])
  })

  it('搜索覆盖书名 / 作者 / 分类 / 出版社 / 年份 / 简介（找「讲拿破仑的」也能搜到）', () => {
    expect(titles(listEntries(lib, { query: '拿破仑' }))).toEqual(['商业甲']) // 简介
    expect(titles(listEntries(lib, { query: '张三' }))).toEqual(['商业甲']) // 作者
    expect(titles(listEntries(lib, { query: 'philosophy' }))).toEqual(['哲学丙']) // 分类（不区分大小写）
    expect(titles(listEntries(lib, { query: '2015' }))).toEqual(['历史乙']) // 年份
    expect(titles(listEntries(lib, { query: '中信', sort: 'name' }))).toEqual(['商业甲', '哲学丙']) // 出版社；书名按拼音：shang < zhe
  })

  it('按出版年份排序：新书在前，没有年份的排最后', () => {
    expect(titles(listEntries(lib, { sort: 'year' }))).toEqual(['哲学丙', '商业甲', '历史乙', '无资料丁'])
  })
})

describe('分组：分类 / 年份 / 出版社', () => {
  it('按分类只算主分类（第一个标签），一本书不会在几个组里重复；没有标签的归「未标注」', () => {
    const groups = groupEntries(listEntries(lib, { sort: 'name' }), 'category')
    const flat = groups.flatMap((g) => g.entries)
    expect(flat).toHaveLength(4)
    expect(new Set(flat.map((e) => e.path)).size).toBe(4)
    expect(groups.find((g) => g.key === 'c:Business')?.entries.map((e) => e.title)).toEqual(['商业甲'])
    expect(groups.at(-1)?.key).toBe('unknown')
  })

  it('按年份：新的年份组在前；未标注最后', () => {
    expect(groupEntries(listEntries(lib), 'year').map((g) => g.key)).toEqual(['y:2023', 'y:2020', 'y:2015', 'unknown'])
  })

  it('按出版社：书多的组在前', () => {
    expect(groupEntries(listEntries(lib), 'publisher').map((g) => g.key)).toEqual(['p:中信出版社', 'p:上海译文出版社', 'unknown'])
    expect(groupKeyOf(book('x'), 'publisher')).toBe('unknown')
  })

  it('groupLabel：分类翻译、年份 / 出版社原文，「未知」按分组方式给出不同文案', () => {
    const t = i18n.getFixedT('zh') as unknown as TFunction
    expect(groupLabel(t, 'c:Business', 'category')).toBe('商业')
    expect(groupLabel(t, 'c:NotInList', 'category')).toBe('NotInList')
    expect(groupLabel(t, 'y:2020', 'year')).toBe('2020')
    expect(groupLabel(t, 'p:中信出版社', 'publisher')).toBe('中信出版社')
    expect(groupLabel(t, 'unknown', 'author')).toBe('未知作者')
    expect(groupLabel(t, 'unknown', 'category')).toBe('未标注')
    expect(groupLabel(t, 'unknown', 'year')).toBe('未标注')
  })
})

describe('同类推荐', () => {
  it('最近读过的书的主分类，会让同类的书被标为「同类」并加权；已读完的不推荐', () => {
    const idx = index(
      book('读过', { subjects: ['Business'], lastOpenedAt: 100, status: 'done', readProgress: { chapterId: 'c', pct: 100 } }),
      book('同类', { subjects: ['Business'] }),
      book('异类', { subjects: ['Art'] }),
      book('无标签')
    )
    const recs = recommendBooks(idx, { seed: 1, count: 10 })
    const by = Object.fromEntries(recs.map((r) => [r.entry.title, r.reason]))
    expect(by['同类']).toBe('sameCategory')
    expect(by['异类']).toBe('fresh')
    expect(by['读过']).toBeUndefined()
  })

  it('同作者优先于同类别（更强的信号）', () => {
    const idx = index(
      book('读过', { subjects: ['Business'], author: 'A', lastOpenedAt: 100, status: 'done', readProgress: { chapterId: 'c', pct: 40 } }),
      book('同作者同类', { subjects: ['Business'], author: 'A' })
    )
    const by = Object.fromEntries(recommendBooks(idx, { seed: 1, count: 10 }).map((r) => [r.entry.title, r.reason]))
    expect(by['同作者同类']).toBe('sameAuthor')
  })

  it('加权确实偏向同类：同样的随机种子下，同类入选率明显高于异类', () => {
    const idx = index(
      book('读过', { subjects: ['Business'], lastOpenedAt: 100, status: 'done', readProgress: { chapterId: 'c', pct: 100 } }),
      ...Array.from({ length: 20 }, (_, i) => book(`同${i}`, { subjects: ['Business'] })),
      ...Array.from({ length: 20 }, (_, i) => book(`异${i}`, { subjects: ['Art'] }))
    )
    let same = 0
    let other = 0
    for (let seed = 1; seed <= 200; seed++) {
      const [first] = recommendBooks(idx, { seed, count: 1 })
      if (first.entry.title.startsWith('同')) same++
      else other++
    }
    expect(same).toBeGreaterThan(other) // 权重 1.3 : 1，期望约 56% : 44%
  })
})

describe('分类标签的 i18n 表', () => {
  it('表里每个键在 zh / en 都存在且非空，两种语言的译名不同于键名（没漏翻）', () => {
    const get = (dict: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict)
    for (const [name, key] of Object.entries(CATEGORY_KEYS)) {
      expect(typeof get(zh, key), `${name} zh`).toBe('string')
      expect(typeof get(en, key), `${name} en`).toBe('string')
      expect(get(zh, key), name).not.toBe('')
    }
    // 反向：locale 里的每个分类也都在表里（加了译文忘了登记会让它永远显示英文原名）
    const registered = new Set(Object.values(CATEGORY_KEYS).map((k) => k.split('.').pop()))
    for (const k of Object.keys((zh as { library: { categories: Record<string, string> } }).library.categories)) expect(registered.has(k), k).toBe(true)
  })

  it('categoryLabel：已知分类翻译；未知分类原样显示（不会显示成键路径）', () => {
    const t = i18n.getFixedT('zh') as unknown as TFunction
    expect(categoryLabel(t, 'Self Help')).toBe('自我提升')
    expect(categoryLabel(t, 'Options (Finance)')).toBe('Options (Finance)')
    expect(categoryLabel(i18n.getFixedT('en') as unknown as TFunction, 'Self Help')).toBe('Self-help')
  })
})

describe('parseOpfMeta：扩展字段', () => {
  const opf = (meta: string, spine = 3) =>
    `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>${meta}</metadata>` +
    `<manifest/><spine>${'<itemref idref="x"/>'.repeat(spine)}</spine></package>`

  it('读取分类 / 简介（去 HTML 标签）/ 出版社 / 年份 / 语言 / 章数', () => {
    const m = parseOpfMeta(
      opf(
        '<dc:title>书</dc:title><dc:creator>作者</dc:creator><dc:subject>Business</dc:subject><dc:subject>History</dc:subject><dc:subject>Business</dc:subject>' +
          '<dc:description>&lt;p&gt;第一段&lt;/p&gt;&lt;p&gt;第二段&lt;/p&gt;</dc:description><dc:publisher>某出版社</dc:publisher><dc:date>2020-12-31T00:00:00+00:00</dc:date><dc:language>zh-CN</dc:language>',
        5
      )
    )
    expect(m).toMatchObject({ title: '书', author: '作者', subjects: ['Business', 'History'], publisher: '某出版社', year: 2020, lang: 'zh-CN', chapterCount: 5 })
    expect(m.desc).toBe('第一段 第二段')
  })

  it('字段缺失时不产生空值（不会把 subjects:[] / year:NaN 写进云端）', () => {
    const m = parseOpfMeta(opf('<dc:title>书</dc:title>', 0))
    expect(m.subjects).toBeUndefined()
    expect(m.desc).toBeUndefined()
    expect(m.year).toBeUndefined()
    expect(m.chapterCount).toBeUndefined()
  })

  it('简介限长 400 字', () => {
    const m = parseOpfMeta(opf(`<dc:description>${'字'.repeat(900)}</dc:description>`))
    expect(m.desc).toHaveLength(400)
  })
})
