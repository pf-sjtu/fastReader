import { describe, it, expect } from 'vitest'
import {
  applyScan,
  continueReading,
  emptyIndex,
  enforceSizeCap,
  listEntries,
  mergeIndexes,
  migrateIndex,
  parseFileName,
  patchEntry,
  setStatus,
  titleFromPath,
} from '@/services/library/libraryIndex'
import type { LibraryIndex, ScannedFile } from '@/services/library/types'

const summaryNameOf = (f: string) => `${f.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const opts = (now: number, names: string[] = []) => ({ now, summaryNameOf, summaryNames: new Set(names) })
const file = (name: string, size = 100, mtime = 'm1', etag?: string): ScannedFile => ({
  path: `/fastReader/${name}`,
  size,
  mtime,
  etag,
})

describe('parseFileName：「书名 - 作者」命名', () => {
  it('epub/pdf 拆出书名与作者；扫描新增条目时直接带上', () => {
    expect(parseFileName('/EBook/癌症传 - 穆克吉.epub')).toEqual({ title: '癌症传', author: '穆克吉' })
    expect(parseFileName('/EBook/2049：未来10000天的可能 - [美] 凯文·凯利.epub')).toEqual({ title: '2049：未来10000天的可能', author: '[美] 凯文·凯利' })
    // 书名里自带 " - " 时按最后一个分隔（作者在最后）
    expect(parseFileName('/x/A - B - 作者.pdf')).toEqual({ title: 'A - B', author: '作者' })
    const e = applyScan(emptyIndex(0), [{ path: '/EBook/癌症传 - 穆克吉.epub', size: 1, mtime: 'm' }], opts(1)).index.entries['/EBook/癌症传 - 穆克吉.epub']
    expect(e).toMatchObject({ title: '癌症传', author: '穆克吉' })
  })

  it('没有分隔 / 分隔在两端 / md、txt：整段当书名，不猜作者', () => {
    expect(parseFileName('/x/门口的野蛮人.epub')).toEqual({ title: '门口的野蛮人' })
    expect(parseFileName('/x/ - 作者.epub')).toEqual({ title: ' - 作者' })
    expect(parseFileName('/x/书名 - .epub')).toEqual({ title: '书名 - ' })
    expect(parseFileName('/x/笔记 - 周报.md')).toEqual({ title: '笔记 - 周报' })
  })
})

describe('titleFromPath', () => {
  it('去目录与扩展名', () => {
    expect(titleFromPath('/a/b/门口的野蛮人.epub')).toBe('门口的野蛮人')
    expect(titleFromPath('plain')).toBe('plain')
  })
})

describe('applyScan：新增 / 失效 / 状态', () => {
  it('新文件建条目：stale、状态由摘要文件决定', () => {
    const r = applyScan(emptyIndex(0), [file('a.epub'), file('b.epub')], opts(10, ['b-完整摘要.md']))
    expect(r.added.sort()).toEqual(['/fastReader/a.epub', '/fastReader/b.epub'])
    const e = r.index.entries
    expect(e['/fastReader/a.epub']).toMatchObject({ status: 'unprocessed', stale: true, title: 'a', updatedAt: 10 })
    expect(e['/fastReader/b.epub']).toMatchObject({ status: 'done', summaryFile: 'b-完整摘要.md' })
  })

  it('源文件 size/mtime 变化 → stale，保留阅读进度与标题', () => {
    const first = applyScan(emptyIndex(0), [file('a.epub', 100, 'm1')], opts(1)).index
    let idx = patchEntry(first, '/fastReader/a.epub', { title: '真标题', stale: false, readProgress: { chapterId: 'c3', pct: 40 } }, 2)
    const r = applyScan(idx, [file('a.epub', 120, 'm1')], opts(3))
    expect(r.changed).toEqual(['/fastReader/a.epub'])
    expect(r.index.entries['/fastReader/a.epub']).toMatchObject({
      stale: true,
      title: '真标题',
      readProgress: { chapterId: 'c3', pct: 40 },
      size: 120,
    })
    // mtime 变也算
    idx = patchEntry(r.index, '/fastReader/a.epub', { stale: false }, 4)
    expect(applyScan(idx, [file('a.epub', 120, 'm2')], opts(5)).changed).toHaveLength(1)
  })

  it('完全没变：不算 changed，不刷新 updatedAt，stale 保持', () => {
    const base = patchEntry(applyScan(emptyIndex(0), [file('a.epub')], opts(1)).index, '/fastReader/a.epub', { stale: false }, 2)
    const r = applyScan(base, [file('a.epub')], opts(99))
    expect(r.changed).toEqual([])
    expect(r.index.entries['/fastReader/a.epub'].stale).toBe(false)
    expect(r.index.entries['/fastReader/a.epub'].updatedAt).toBe(2)
  })

  it('etag 只在两边都有时才比较', () => {
    const base = patchEntry(applyScan(emptyIndex(0), [file('a.epub', 1, 'm', 'e1')], opts(1)).index, '/fastReader/a.epub', { stale: false }, 2)
    expect(applyScan(base, [file('a.epub', 1, 'm', 'e2')], opts(3)).changed).toHaveLength(1)
    expect(applyScan(base, [file('a.epub', 1, 'm', undefined)], opts(3)).changed).toHaveLength(0)
  })

  it('摘要被删 → 回到 unprocessed 并清掉 summaryFile；partial 不会被扫描降级成 done', () => {
    let idx = applyScan(emptyIndex(0), [file('a.epub')], opts(1, ['a-完整摘要.md'])).index
    expect(idx.entries['/fastReader/a.epub'].status).toBe('done')
    idx = patchEntry(idx, '/fastReader/a.epub', { status: 'partial' }, 2)
    expect(applyScan(idx, [file('a.epub')], opts(3, ['a-完整摘要.md'])).index.entries['/fastReader/a.epub'].status).toBe('partial')
    const gone = applyScan(idx, [file('a.epub')], opts(4, [])).index.entries['/fastReader/a.epub']
    expect(gone.status).toBe('unprocessed')
    expect(gone.summaryFile).toBeUndefined()
  })
})

describe('applyScan：GC（连续缺席才删，防网络抖动）', () => {
  it('缺席 1 次保留并计数，第 2 次删除；中途再出现则清零', () => {
    const idx0 = applyScan(emptyIndex(0), [file('a.epub'), file('b.epub')], opts(1)).index
    const r1 = applyScan(idx0, [file('b.epub')], opts(2))
    expect(r1.removed).toEqual([])
    expect(r1.index.entries['/fastReader/a.epub'].missingScans).toBe(1)

    const back = applyScan(r1.index, [file('a.epub'), file('b.epub')], opts(3))
    expect(back.index.entries['/fastReader/a.epub'].missingScans).toBe(0)

    const m1 = applyScan(back.index, [file('b.epub')], opts(4)).index
    const m2 = applyScan(m1, [file('b.epub')], opts(5))
    expect(m2.removed).toEqual(['/fastReader/a.epub'])
    expect(m2.index.entries['/fastReader/a.epub']).toBeUndefined()
  })
})

describe('applyScan：早期误收录的处理产物', () => {
  it('旧索引里的 _chapter_N_summary.md 条目下次扫描立刻清除（不等两轮），真书保留', () => {
    const idx0 = applyScan(emptyIndex(0), [file('书_chapter_3_summary.md'), file('书_chapter_4_summary.md'), file('书.epub')], opts(1)).index
    // 新版本的扫描已不再把产物当书（只传入真书）
    const r = applyScan(idx0, [file('书.epub')], opts(2))
    expect(r.removed.sort()).toEqual(['/fastReader/书_chapter_3_summary.md', '/fastReader/书_chapter_4_summary.md'])
    expect(Object.keys(r.index.entries)).toEqual(['/fastReader/书.epub'])
  })
})

describe('migrateIndex：版本与脏数据', () => {
  it('版本不匹配/缺失/结构坏 → null（调用方重建）', () => {
    expect(migrateIndex(null)).toBeNull()
    expect(migrateIndex('x')).toBeNull()
    expect(migrateIndex({ entries: {} })).toBeNull()
    expect(migrateIndex({ schemaVersion: 99, entries: {} })).toBeNull()
    expect(migrateIndex({ schemaVersion: 1, entries: [] })).toBeNull()
  })

  it('合法版本：逐条清洗，丢弃缺 path 的条目，修正越界/非法字段', () => {
    const idx = migrateIndex({
      schemaVersion: 1,
      updatedAt: 5,
      entries: {
        a: { path: '/x/a.epub', size: 'NaN', status: 'weird', readProgress: { chapterId: 'c1', pct: 250 }, missingScans: -3 },
        bad: { size: 1 },
        n: null,
      },
    })!
    expect(Object.keys(idx.entries)).toEqual(['/x/a.epub'])
    expect(idx.entries['/x/a.epub']).toMatchObject({
      size: 0,
      status: 'unprocessed',
      title: 'a',
      missingScans: 0,
      readProgress: { chapterId: 'c1', pct: 100 },
    })
  })
})

describe('mergeIndexes：条目级 updatedAt 取新', () => {
  it('同一条目取更新者；两边独有的条目都保留', () => {
    const mk = (path: string, updatedAt: number, title: string): LibraryIndex => ({
      schemaVersion: 1,
      updatedAt,
      entries: {
        [path]: { path, size: 0, mtime: '', title, status: 'unprocessed', stale: false, missingScans: 0, updatedAt },
      },
    })
    const a = mk('/p/x.epub', 5, '旧')
    const b = { ...mk('/p/x.epub', 9, '新'), entries: { ...mk('/p/x.epub', 9, '新').entries, ...mk('/p/y.epub', 1, 'y').entries } }
    const m = mergeIndexes(a, b)
    expect(m.entries['/p/x.epub'].title).toBe('新')
    expect(m.entries['/p/y.epub']).toBeDefined()
    expect(mergeIndexes(b, a).entries['/p/x.epub'].title).toBe('新') // 与顺序无关
  })
})

describe('setStatus / patchEntry', () => {
  it('状态与摘要文件名同一次更新；回到 unprocessed 清掉摘要名；未知路径原样返回', () => {
    const idx = applyScan(emptyIndex(0), [file('a.epub')], opts(1)).index
    const done = setStatus(idx, '/fastReader/a.epub', 'done', 'a-完整摘要.md', 2)
    expect(done.entries['/fastReader/a.epub']).toMatchObject({ status: 'done', summaryFile: 'a-完整摘要.md', updatedAt: 2 })
    const cleared = setStatus(done, '/fastReader/a.epub', 'unprocessed', 'ignored', 3)
    expect(cleared.entries['/fastReader/a.epub'].summaryFile).toBeUndefined()
    expect(setStatus(idx, '/nope', 'done', 'x', 9)).toBe(idx)
  })
})

describe('enforceSizeCap', () => {
  it('超限时淘汰最久未打开的，保留最近打开的', () => {
    let idx = emptyIndex(0)
    const files = Array.from({ length: 20 }, (_, i) => file(`book-${i}.epub`))
    idx = applyScan(idx, files, opts(1)).index
    idx = patchEntry(idx, '/fastReader/book-7.epub', { lastOpenedAt: 1000 }, 2)
    const total = new TextEncoder().encode(JSON.stringify(idx)).length
    const { index, evicted } = enforceSizeCap(idx, Math.floor(total / 2))
    expect(evicted.length).toBeGreaterThan(0)
    expect(index.entries['/fastReader/book-7.epub']).toBeDefined()
    expect(new TextEncoder().encode(JSON.stringify(index)).length).toBeLessThanOrEqual(Math.floor(total / 2))
  })

  it('没超限不动；极小上限也至少保留一条', () => {
    const idx = applyScan(emptyIndex(0), [file('a.epub'), file('b.epub')], opts(1)).index
    expect(enforceSizeCap(idx, 10_000_000).evicted).toEqual([])
    expect(Object.keys(enforceSizeCap(idx, 1).index.entries)).toHaveLength(1)
  })
})

describe('listEntries / continueReading', () => {
  const idx = (() => {
    let i = applyScan(emptyIndex(0), [file('甲.epub'), file('乙.epub'), file('丙.epub')], opts(1, ['乙-完整摘要.md'])).index
    i = patchEntry(i, '/fastReader/乙.epub', { lastOpenedAt: 50, author: '张三', readProgress: { chapterId: 'c2', pct: 30 } }, 2)
    i = patchEntry(i, '/fastReader/丙.epub', { lastOpenedAt: 90, status: 'partial' }, 2)
    return i
  })()

  it('筛选、搜索（标题+作者）、排序', () => {
    expect(listEntries(idx, { filter: 'done' }).map((e) => e.title)).toEqual(['乙'])
    expect(listEntries(idx, { filter: 'todo' }).map((e) => e.title).sort()).toEqual(['丙', '甲'].sort())
    expect(listEntries(idx, { query: '张三' }).map((e) => e.title)).toEqual(['乙'])
    expect(listEntries(idx, { sort: 'recent' }).map((e) => e.title)[0]).toBe('丙')
    expect(listEntries(idx, { sort: 'status' }).map((e) => e.status)).toEqual(['partial', 'unprocessed', 'done'])
  })

  it('继续阅读：打开过、已处理、未读完；最近在前；未处理的不出现', () => {
    expect(continueReading(idx).map((e) => e.title)).toEqual(['丙', '乙'])
    const finished = patchEntry(idx, '/fastReader/乙.epub', { readProgress: { chapterId: 'c9', pct: 100 } }, 3)
    expect(continueReading(finished).map((e) => e.title)).toEqual(['丙'])
  })
})
