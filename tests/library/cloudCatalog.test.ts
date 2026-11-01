/**
 * 云端书目叠加：书架 = WebDAV 书库索引 ∪ 云端书目。重点是不重复、不误配、不污染 WebDAV 索引。
 */
import { describe, it, expect, vi } from 'vitest'
import { buildCatalogMeta, buildShelf, categoryCounts, findRealEntry, isVirtualPath, virtualEntries, virtualPath } from '@/services/library/cloudCatalog'
import { bookIdOf } from '@/services/library/bookId'
import { deleteCovers, uploadCover, type CoverIndex } from '@/services/library/cloudCovers'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const scan = (...names: string[]) =>
  applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1000, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index

const item = (title: string, extra: Record<string, unknown> = {}) => ({ stem: title, title, file: `${title}.epub`, ...extra })

describe('buildShelf', () => {
  it('云端目录为空：原样返回同一个索引对象（零开销，也不会让依赖它的 memo 失效）', () => {
    const idx = scan('甲.epub')
    expect(buildShelf(idx, {})).toBe(idx)
  })

  it('WebDAV 为空：整个书架由云端书目撑起，全是虚拟条目，路径不是 WebDAV 路径', () => {
    const a = bookIdOf('甲.epub')
    const shelf = buildShelf(emptyIndex(0), { [a]: item('甲', { cover: 1, size: 5000, subjects: ['Business'], year: 2020 }) as never })
    const e = Object.values(shelf.entries)[0]
    expect(e).toMatchObject({ virtual: true, catalogId: a, title: '甲', coverKey: a, size: 5000, year: 2020, subjects: ['Business'], status: 'unprocessed', stale: false })
    expect(isVirtualPath(e.path)).toBe(true)
    expect(e.path).toBe(virtualPath(a, '甲.epub'))
    expect(e.path.endsWith('.epub')).toBe(true) // 书卡靠扩展名显示格式
  })

  it('同一本书在两边都有：只出现一次，保留 WebDAV 的状态 / 进度，叠加云端的分类与简介', () => {
    const idx = scan('甲.epub')
    idx.entries['/EBook/甲.epub'].status = 'done'
    idx.entries['/EBook/甲.epub'].readProgress = { chapterId: 'c1', pct: 30 }
    const id = bookIdOf('/EBook/甲.epub')
    const shelf = buildShelf(idx, { [id]: item('甲', { subjects: ['History'], desc: '简介', publisher: '社', year: 2019, cover: 1 }) as never })
    expect(Object.keys(shelf.entries)).toEqual(['/EBook/甲.epub'])
    expect(shelf.entries['/EBook/甲.epub']).toMatchObject({ status: 'done', readProgress: { pct: 30 }, catalogId: id, subjects: ['History'], desc: '简介', publisher: '社', year: 2019, coverKey: id })
    expect(shelf.entries['/EBook/甲.epub'].virtual).toBeUndefined()
  })

  it('叠加不改写传入的索引（云端数据只在内存里，不会被存回 WebDAV 的 library.json）', () => {
    const idx = scan('甲.epub')
    const before = JSON.stringify(idx)
    buildShelf(idx, { [bookIdOf('/EBook/甲.epub')]: item('甲', { subjects: ['History'] }) as never })
    expect(JSON.stringify(idx)).toBe(before)
  })

  it('stale 的真实条目：云端已有资料就采用并视为已解决（否则会误提示「下载整本书来补全」）', () => {
    const idx = scan('甲.epub')
    expect(idx.entries['/EBook/甲.epub'].stale).toBe(true)
    const id = bookIdOf('/EBook/甲.epub')
    const e = buildShelf(idx, { [id]: item('正式书名', { author: '作者' }) as never }).entries['/EBook/甲.epub']
    expect(e).toMatchObject({ stale: false, title: '正式书名', author: '作者' })
  })

  it('云端记录的大小与 WebDAV 不一致（书被换过）：重新标 stale + catalogChanged；一致或云端没记大小则不动', () => {
    const id = bookIdOf('/EBook/甲.epub')
    const mk = (cloudSize?: number, localSize = 1000) => {
      const idx = scan('甲.epub')
      idx.entries['/EBook/甲.epub'] = { ...idx.entries['/EBook/甲.epub'], size: localSize, stale: false }
      return buildShelf(idx, { [id]: item('甲', cloudSize ? { size: cloudSize } : {}) as never }).entries['/EBook/甲.epub']
    }
    expect(mk(5000)).toMatchObject({ stale: true, catalogChanged: true })
    expect(mk(1000)).toMatchObject({ stale: false })
    expect(mk(1000).catalogChanged).toBeUndefined()
    expect(mk(undefined).stale).toBe(false) // 老条目没记大小：无从比较，不误报
    expect(mk(5000, 0).stale).toBe(false) // 本地大小未知（0）：同样不误报
  })

  it('已有书名 / 作者不被云端覆盖（只补缺）；「未知…」占位词不会当成有效值', () => {
    const idx = scan('甲.epub')
    idx.entries['/EBook/甲.epub'] = { ...idx.entries['/EBook/甲.epub'], stale: false, title: '本地书名', author: '本地作者' }
    const id = bookIdOf('/EBook/甲.epub')
    const e = buildShelf(idx, { [id]: item('云端书名', { author: '云端作者' }) as never }).entries['/EBook/甲.epub']
    expect(e).toMatchObject({ title: '本地书名', author: '本地作者' })
    const v = Object.values(buildShelf(emptyIndex(0), { bk_zzzzzz: { stem: '真名', title: '未知书名', file: 'x.epub' } as never }).entries)[0]
    expect(v.title).toBe('真名') // 占位书名退回 stem
  })

  it('模糊匹配：文件名与云端主干略有差异也认作同一本，不会既出真实条目又出虚拟条目', () => {
    const stem = '穷查理宝典：查理·芒格的智慧箴言录 - 彼得·考夫曼'
    const idx = scan(`${stem}（第三版）.epub`)
    const catalog: CoverIndex = { [bookIdOf(`${stem}.epub`)]: item(stem, { stem }) as never }
    const shelf = buildShelf(idx, catalog)
    expect(Object.values(shelf.entries)).toHaveLength(1)
    expect(virtualEntries(shelf)).toHaveLength(0)
  })

  it('一对一：X.epub 与 X.pdf 的云端 id 相同，只有云端记录的那个文件拿到它；另一个不再「补全」（否则互相覆盖）', () => {
    const idx = scan('甲.epub', '甲.pdf')
    const id = bookIdOf('甲.epub')
    expect(bookIdOf('甲.pdf')).toBe(id)
    const shelf = buildShelf(idx, { [id]: item('甲', { file: '甲.pdf', size: 1000 }) as never })
    expect(shelf.entries['/EBook/甲.pdf'].catalogId).toBe(id)
    expect(shelf.entries['/EBook/甲.epub'].catalogId).toBeUndefined()
    expect(shelf.entries['/EBook/甲.epub'].stale).toBe(false)
    expect(virtualEntries(shelf)).toHaveLength(0)
  })

  it('一对一：「X」与「X（第三版）」同时在，精确的那本拿云端条目，邻近版本不抢，仍可自己补全', () => {
    const idx = scan('经济学原理.epub', '经济学原理（第三版）.epub')
    const id = bookIdOf('经济学原理.epub')
    const shelf = buildShelf(idx, { [id]: item('经济学原理', { size: 5000 }) as never })
    expect(shelf.entries['/EBook/经济学原理.epub'].catalogId).toBe(id)
    expect(shelf.entries['/EBook/经济学原理（第三版）.epub'].catalogId).toBeUndefined()
    expect(shelf.entries['/EBook/经济学原理（第三版）.epub'].stale).toBe(true) // id 不同：补全会建自己的条目
  })

  it('文件名与云端记录不一致时，大小不同不算「书被换过」（否则邻近版本会反复覆盖封面）', () => {
    const idx = scan('甲.epub')
    const id = bookIdOf('甲.epub')
    const e = buildShelf(idx, { [id]: item('甲', { file: '甲（旧版）.epub', size: 5000 }) as never }).entries['/EBook/甲.epub']
    expect(e.catalogChanged).toBeUndefined()
  })

  it('歧义宁可不配：两本很像的书不会互相抢封面（多出一个虚拟条目，由「点开时核对」兜底）', () => {
    const idx = scan('经济学原理（上册）.epub')
    const catalog: CoverIndex = {
      [bookIdOf('经济学原理（下册）.epub')]: item('经济学原理（下册）', { stem: '经济学原理（下册）' }) as never,
      [bookIdOf('经济学原理（中册）.epub')]: item('经济学原理（中册）', { stem: '经济学原理（中册）' }) as never,
    }
    const shelf = buildShelf(idx, catalog)
    expect(Object.values(shelf.entries).filter((e) => !e.virtual)[0].catalogId).toBeUndefined()
    expect(virtualEntries(shelf)).toHaveLength(2)
  })

  it('大目录性能：646 本云端 + 600 本 WebDAV，叠加一次远小于一帧的几倍；第二次命中缓存', () => {
    const names = Array.from({ length: 600 }, (_, i) => `测试书籍第${String(i).padStart(4, '0')}号 - 作者${i % 37}.epub`)
    const idx = scan(...names)
    const catalog: CoverIndex = {}
    for (const n of Array.from({ length: 646 }, (_, i) => `测试书籍第${String(i).padStart(4, '0')}号 - 作者${i % 37}.epub`)) catalog[bookIdOf(n)] = item(n.replace(/\.epub$/, ''), { cover: 1 }) as never
    const t0 = performance.now()
    const shelf = buildShelf(idx, catalog)
    const first = performance.now() - t0
    expect(Object.keys(shelf.entries)).toHaveLength(646) // 600 个真实 + 46 个仅云端
    expect(virtualEntries(shelf)).toHaveLength(46)
    const t1 = performance.now()
    buildShelf(idx, catalog)
    expect(performance.now() - t1).toBeLessThan(Math.max(first, 5))
    expect(first).toBeLessThan(1500)
  })
})

describe('findRealEntry / categoryCounts', () => {
  it('在 WebDAV 索引里按云端 id 找真实条目；虚拟条目不算；找不到返回 null', () => {
    const idx = scan('甲.epub')
    const id = bookIdOf('/EBook/甲.epub')
    const catalog: CoverIndex = { [id]: item('甲') as never }
    expect(findRealEntry(idx, catalog, id)?.path).toBe('/EBook/甲.epub')
    expect(findRealEntry(idx, catalog, 'bk_nothere')).toBeNull()
    expect(findRealEntry(buildShelf(emptyIndex(0), catalog), catalog, id)).toBeNull() // 书架里的虚拟条目不是真实文件
  })

  it('分类统计：多标签各计一次，数量降序，同数量按名称', () => {
    const shelf = buildShelf(emptyIndex(0), {
      bk_aaaaaa: item('a', { subjects: ['Business', 'History'] }) as never,
      bk_bbbbbb: item('b', { subjects: ['Business'] }) as never,
      bk_cccccc: item('c', { subjects: ['Art'] }) as never,
      bk_dddddd: item('d') as never,
    })
    expect(categoryCounts(Object.values(shelf.entries))).toEqual([
      { name: 'Business', count: 2 },
      { name: 'Art', count: 1 },
      { name: 'History', count: 1 },
    ])
  })
})

describe('buildCatalogMeta', () => {
  it('把解析结果整理成云端元数据：文件名取路径末段，size 为 0 时省略，占位书名用兜底', () => {
    const m = buildCatalogMeta('/EBook/子目录/书.epub', 0, { title: '未知书名', author: 'A', subjects: ['Business'], year: 2020, chapterCount: 12 }, '兜底书名')
    expect(m).toMatchObject({ stem: '书', title: '兜底书名', author: 'A', file: '书.epub', subjects: ['Business'], year: 2020, chapterCount: 12 })
    expect(m.size).toBeUndefined()
    expect(buildCatalogMeta('/a/b.epub', 123, { title: '真书名' }, 'x')).toMatchObject({ title: '真书名', size: 123 })
  })
})

describe('cloudCovers 客户端：上传选项与删除', () => {
  it('uploadCover：无图 = 只更新元数据（空 body）；replace 带 ?replace=1', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true })
    await uploadCover('bk_aaaaaa', { stem: 's', title: 't' }, null, f as never, { replace: true })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/covers/bk_aaaaaa?replace=1')
    expect(init.method).toBe('PUT')
    expect(init.body).toBeUndefined()
    expect(decodeURIComponent(init.headers['X-Book-Meta'])).toContain('"title":"t"')
    await uploadCover('bk_aaaaaa', { stem: 's', title: 't' }, new Blob(['x']), f as never)
    expect(f.mock.calls[1][0]).toBe('/api/covers/bk_aaaaaa')
  })

  it('uploadCover：网络异常返回 false 而不是抛出', async () => {
    expect(await uploadCover('bk_aaaaaa', { stem: 's', title: 't' }, null, vi.fn().mockRejectedValue(new Error('x')) as never)).toBe(false)
  })

  it('deleteCovers：按 200 一批、只返回服务端确认删除的 id；某批失败不影响其他批，也不抛', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `bk_${String(i).padStart(7, 'a')}`)
    let call = 0
    const f = vi.fn(async (_url: string, init: { body: string }) => {
      call++
      if (call === 2) throw new Error('网络')
      const batch = (JSON.parse(init.body) as { ids: string[] }).ids
      return { ok: true, json: async () => ({ results: batch.map((id) => ({ id, status: 'deleted' })) }) }
    })
    const done = await deleteCovers(ids, f as never)
    expect(f).toHaveBeenCalledTimes(3)
    expect(done).toHaveLength(250) // 第 2 批（200 个）失败
    expect(done).toContain(ids[0])
    expect(done).not.toContain(ids[250])
  })

  it('deleteCovers：服务端返回非 2xx 或逐条非 deleted 时不算删除', async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false })
    expect(await deleteCovers(['bk_aaaaaa'], bad as never)).toEqual([])
    const partial = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ id: 'bk_aaaaaa', status: 'bad_id' }] }) })
    expect(await deleteCovers(['bk_aaaaaa'], partial as never)).toEqual([])
  })
})
