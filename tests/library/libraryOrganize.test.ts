import { describe, it, expect } from 'vitest'
import { applyScan, emptyIndex, listEntries, patchEntry } from '@/services/library/libraryIndex'
import { groupEntries, groupKeyOf, limitGroups, recommendBooks, seededRandom } from '@/services/library/libraryOrganize'
import type { LibraryIndex } from '@/services/library/types'

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const build = (specs: { path: string; size?: number; mtime?: string }[], done: string[] = []): LibraryIndex =>
  applyScan(emptyIndex(0), specs.map((s) => ({ path: s.path, size: s.size ?? 100, mtime: s.mtime ?? '' })), {
    now: 1,
    summaryNameOf: sum,
    summaryNames: new Set(done.map(sum)),
  }).index

const lib = (() => {
  let i = build(
    [
      { path: '/s/a.epub', size: 300, mtime: 'Wed, 01 Jan 2025 00:00:00 GMT' },
      { path: '/s/b.pdf', size: 900, mtime: 'Wed, 01 Jan 2026 00:00:00 GMT' },
      { path: '/s/历史/c.epub', size: 100, mtime: 'garbage' },
      { path: '/s/历史/d.epub', size: 500 },
      { path: '/s/e.txt' },
    ],
    ['a.epub']
  )
  i = patchEntry(i, '/s/a.epub', { author: '张三', title: 'A' }, 2)
  i = patchEntry(i, '/s/历史/c.epub', { author: '张三', title: 'C' }, 2)
  i = patchEntry(i, '/s/历史/d.epub', { author: '李四', title: 'D', readProgress: { chapterId: 'c1', pct: 30 }, lastOpenedAt: 9, status: 'partial' }, 2)
  i = patchEntry(i, '/s/b.pdf', { title: 'B' }, 2)
  i = patchEntry(i, '/s/e.txt', { title: 'E' }, 2)
  return i
})()
const titles = (l: ReturnType<typeof listEntries>) => l.map((e) => e.title)

describe('排序（metadata 驱动）', () => {
  it('作者：按拼音序（李四 < 张三）、同作者按书名，无作者的垫底', () => {
    expect(titles(listEntries(lib, { sort: 'author' }))).toEqual(['D', 'A', 'C', 'B', 'E'])
  })
  it('大小：大的在前', () => {
    expect(titles(listEntries(lib, { sort: 'size' })).slice(0, 3)).toEqual(['B', 'D', 'A'])
  })
  it('更新时间：新的在前；无法解析的日期按最旧处理而不是 NaN 乱序', () => {
    const t = titles(listEntries(lib, { sort: 'modified' }))
    expect(t.slice(0, 2)).toEqual(['B', 'A'])
    expect(t).toHaveLength(5)
  })
  it('进度：已精读 > 读了一部分 > 没读', () => {
    expect(titles(listEntries(lib, { sort: 'progress' })).slice(0, 2)).toEqual(['A', 'D'])
  })
})

describe('分类', () => {
  it('groupKeyOf：状态把"读到一半"单列；格式按扩展名；目录按直接父目录', () => {
    const e = (p: string) => lib.entries[p]
    expect(groupKeyOf(e('/s/历史/d.epub'), 'status')).toBe('reading')
    expect(groupKeyOf(e('/s/a.epub'), 'status')).toBe('done')
    expect(groupKeyOf(e('/s/b.pdf'), 'format')).toBe('pdf')
    expect(groupKeyOf(e('/s/历史/c.epub'), 'folder')).toBe('d:历史')
    expect(groupKeyOf(e('/s/a.epub'), 'folder')).toBe('root')
    expect(groupKeyOf(e('/s/b.pdf'), 'author')).toBe('unknown')
  })

  it('none = 单组；空列表 = 无组', () => {
    expect(groupEntries(listEntries(lib), 'none')).toHaveLength(1)
    expect(groupEntries([], 'none')).toEqual([])
  })

  it('状态分组按语义顺序：在读 → 未处理 → 已精读', () => {
    expect(groupEntries(listEntries(lib), 'status').map((g) => g.key)).toEqual(['reading', 'unprocessed', 'done'])
  })

  it('作者分组：书多的在前，未知作者永远最后；每本书恰好出现一次', () => {
    const groups = groupEntries(listEntries(lib), 'author')
    expect(groups.map((g) => g.key)).toEqual(['a:张三', 'a:李四', 'unknown'])
    expect(groups.flatMap((g) => g.entries).length).toBe(5)
    expect(groups[2].entries.map((e) => e.title).sort()).toEqual(['B', 'E'])
  })

  it('格式分组：固定顺序 epub → pdf → txt', () => {
    expect(groupEntries(listEntries(lib), 'format').map((g) => g.key)).toEqual(['epub', 'pdf', 'txt'])
  })
})

describe('limitGroups（分页）', () => {
  const mk = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ path: `/${prefix}${i}.epub` }) as never)
  const groups = [
    { key: 'a', entries: mk(5, 'a') },
    { key: 'b', entries: mk(5, 'b') },
    { key: 'c', entries: mk(5, 'c') },
  ]

  it('跨组累计截取；total 仍是该组全部数量；分不到书的组丢弃', () => {
    const r = limitGroups(groups, 7)
    expect(r.map((g) => [g.key, g.entries.length, g.total])).toEqual([['a', 5, 5], ['b', 2, 5]])
  })

  it('上限足够大：原样返回；上限 0/负数：空', () => {
    expect(limitGroups(groups, 100).map((g) => g.entries.length)).toEqual([5, 5, 5])
    expect(limitGroups(groups, 0)).toEqual([])
    expect(limitGroups(groups, -3)).toEqual([])
  })

  it('不改动传入的分组', () => {
    limitGroups(groups, 2)
    expect(groups[0].entries).toHaveLength(5)
  })
})

describe('seededRandom', () => {
  it('同种子同序列、值域 [0,1)、不同种子序列不同', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    const sa = Array.from({ length: 5 }, a)
    expect(sa).toEqual(Array.from({ length: 5 }, b))
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(sa).not.toEqual(Array.from({ length: 5 }, seededRandom(8)))
  })
})

describe('recommendBooks（乱序推荐）', () => {
  const many = (() => {
    const specs = Array.from({ length: 30 }, (_, i) => ({ path: `/s/b${i}.epub` }))
    let i = build(specs, ['b0.epub', 'b1.epub'])
    // b0 读完（不应推荐）；b1 读到一半（应是 resume）
    i = patchEntry(i, '/s/b0.epub', { readProgress: { chapterId: 'c', pct: 100 } }, 2)
    i = patchEntry(i, '/s/b1.epub', { readProgress: { chapterId: 'c', pct: 40 }, lastOpenedAt: 5, author: '甲' }, 2)
    i = patchEntry(i, '/s/b2.epub', { author: '甲' }, 2)
    return i
  })()
  const paths = (r: ReturnType<typeof recommendBooks>) => r.map((x) => x.entry.path)

  it('可复现：同一书库 + 同一 seed → 同一结果；换 seed 即换一批', () => {
    expect(paths(recommendBooks(many, { seed: 1 }))).toEqual(paths(recommendBooks(many, { seed: 1 })))
    expect(paths(recommendBooks(many, { seed: 1 }))).not.toEqual(paths(recommendBooks(many, { seed: 2 })))
  })

  it('不推荐读完的书；结果无重复；数量受 count 限制', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = paths(recommendBooks(many, { seed, count: 6 }))
      expect(r).toHaveLength(6)
      expect(new Set(r).size).toBe(6)
      expect(r).not.toContain('/s/b0.epub')
    }
  })

  it('接着读的书被抽中的概率明显更高（权重生效），且理由为 resume', () => {
    let hits = 0
    for (let seed = 0; seed < 200; seed++) {
      const r = recommendBooks(many, { seed, count: 3 })
      const hit = r.find((x) => x.entry.path === '/s/b1.epub')
      if (hit) {
        hits++
        expect(hit.reason).toBe('resume')
      }
    }
    // 29 本候选抽 3，均匀概率约 10%（≈20/200）；权重 20 应使其近半数批次都出现
    expect(hits).toBeGreaterThan(80)
  })

  it('同作者加权：最近读过的作者的其它书理由为 sameAuthor', () => {
    const all = Array.from({ length: 40 }, (_, seed) => recommendBooks(many, { seed, count: 8 })).flat()
    expect(all.find((x) => x.entry.path === '/s/b2.epub')?.reason).toBe('sameAuthor')
  })

  it('换一批：优先避开上一批；候选不足时才回填', () => {
    const first = paths(recommendBooks(many, { seed: 3, count: 6 }))
    const second = paths(recommendBooks(many, { seed: 4, count: 6, exclude: first }))
    expect(second.filter((p) => first.includes(p))).toEqual([])
    const tiny = build([{ path: '/s/x.epub' }, { path: '/s/y.epub' }])
    const r = paths(recommendBooks(tiny, { seed: 1, count: 2, exclude: ['/s/x.epub'] }))
    expect(r).toHaveLength(2) // 避开 x 后只剩 y，再回填 x
    expect(r[0]).toBe('/s/y.epub')
  })

  it('空书库/全部读完：返回空数组而不是抛错', () => {
    expect(recommendBooks(emptyIndex(0), { seed: 1 })).toEqual([])
    const done = patchEntry(build([{ path: '/s/a.epub' }], ['a.epub']), '/s/a.epub', { readProgress: { chapterId: 'c', pct: 100 } }, 2)
    expect(recommendBooks(done, { seed: 1 })).toEqual([])
  })
})

describe('recommendBooks omit（硬排除）', () => {
  it('omit 的书任何种子下都不会出现，即使候选不足也不回填', () => {
    const idx = build([{ path: '/s/a.epub' }, { path: '/s/b.epub' }, { path: '/s/c.epub' }])
    for (let seed = 0; seed < 30; seed++) {
      const r = recommendBooks(idx, { seed, count: 3, omit: ['/s/a.epub'] }).map((x) => x.entry.path)
      expect(r).not.toContain('/s/a.epub')
      expect(r).toHaveLength(2)
    }
  })
})
