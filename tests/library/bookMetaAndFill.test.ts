import { describe, it, expect, vi } from 'vitest'
import { gunzipToText, gzipText, isGzip, pipeBytes } from '@/services/library/gzip'
import { findCoverHref, listZipEntries, parseOpfMeta, readEpubMeta, resolveZipPath } from '@/services/library/bookMeta'
import { thumbSize } from '@/services/library/coverThumb'
import { CLOUD_COVER_CONCURRENCY, COVER_FETCH_CONCURRENCY, createCoverLoader } from '@/services/library/coverLoader'
import { coverKeyOf, FILL_CONCURRENCY, fillLibraryMetadata, type Inspection } from '@/services/library/libraryFill'
import { bookIdOf } from '@/services/library/bookId'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'
import { refreshLibrary, type LibraryIO } from '@/services/library/libraryService'
import type { LibraryEntry } from '@/services/library/types'

/* ---------- 测试用 ZIP 构造（读取器不校验 CRC，写 0 即可） ---------- */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await pipeBytes(data, new CompressionStream('deflate-raw')))
}
async function makeZip(files: Record<string, string | Uint8Array>, deflate: string[] = []): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => [n & 255, (n >> 8) & 255]
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? enc.encode(content) : content
    const method = deflate.includes(name) ? 8 : 0
    const data = method === 8 ? await deflateRaw(raw) : raw
    const nameB = enc.encode(name)
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...nameB, ...data])
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB]))
    parts.push(local)
    offset += local.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(offset), ...u16(0)])
  const all = [...parts, ...central, eocd]
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out.buffer
}

const CONTAINER = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
const OPF2 = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>  门口的
 野蛮人 </dc:title><dc:creator>布赖恩·伯勒</dc:creator><dc:creator>约翰·赫尔扬</dc:creator><meta name="cover" content="cvr"/></metadata><manifest><item id="cvr" href="images/cover%20art.jpg" media-type="image/jpeg"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest></package>`

describe('gzip', () => {
  it('往返无损（含中文），并能识别魔数；压缩有效', async () => {
    const text = JSON.stringify({ entries: Array.from({ length: 200 }, (_, i) => ({ title: `书籍标题 ${i}`, path: `/fastReader/书籍标题 ${i}.epub` })) })
    const gz = await gzipText(text)
    expect(isGzip(gz)).toBe(true)
    expect(gz.byteLength).toBeLessThan(new TextEncoder().encode(text).length / 3)
    expect(await gunzipToText(gz)).toBe(text)
    expect(isGzip(new TextEncoder().encode('{"a":1}').buffer)).toBe(false)
    expect(isGzip(new ArrayBuffer(0))).toBe(false)
  })
})

describe('OPF / 封面定位', () => {
  it('parseOpfMeta：折叠空白、多作者合并、忽略命名空间前缀', () => {
    expect(parseOpfMeta(OPF2)).toEqual({ title: '门口的 野蛮人', author: '布赖恩·伯勒、约翰·赫尔扬' })
    expect(parseOpfMeta('<not xml')).toEqual({})
  })

  it('findCoverHref：EPUB3 properties > EPUB2 meta cover > 文件名猜测 > null', () => {
    expect(findCoverHref(OPF2)).toEqual({ href: 'images/cover%20art.jpg', mime: 'image/jpeg' })
    const v3 = `<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="x" href="a.png" media-type="image/png" properties="cover-image"/><item id="cvr" href="b.jpg" media-type="image/jpeg"/></manifest><metadata><meta name="cover" content="cvr"/></metadata></package>`
    expect(findCoverHref(v3)?.href).toBe('a.png')
    const guess = `<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="img1" href="img/Cover.jpeg" media-type="image/jpeg"/><item id="img2" href="img/p1.jpeg" media-type="image/jpeg"/></manifest></package>`
    expect(findCoverHref(guess)?.href).toBe('img/Cover.jpeg')
    expect(findCoverHref(`<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest></package>`)).toBeNull()
  })

  it('resolveZipPath：相对 OPF 目录、处理 ../ 与 URL 编码', () => {
    expect(resolveZipPath('OEBPS/content.opf', 'images/cover%20art.jpg')).toBe('OEBPS/images/cover art.jpg')
    expect(resolveZipPath('OEBPS/content.opf', '../cover.jpg')).toBe('cover.jpg')
    expect(resolveZipPath('content.opf', './c.jpg#x')).toBe('c.jpg')
  })
})

describe('readEpubMeta：真实 ZIP（stored + deflate）', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

  it('读出书名/作者/封面字节；压缩与未压缩条目都能读', async () => {
    const buf = await makeZip(
      { mimetype: 'application/epub+zip', 'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': OPF2, 'OEBPS/images/cover art.jpg': jpeg },
      ['OEBPS/content.opf', 'META-INF/container.xml']
    )
    const meta = await readEpubMeta(buf)
    expect(meta.title).toBe('门口的 野蛮人')
    expect(meta.author).toBe('布赖恩·伯勒、约翰·赫尔扬')
    expect(meta.cover?.mime).toBe('image/jpeg')
    expect(Array.from(meta.cover!.bytes)).toEqual(Array.from(jpeg))
  })

  it('封面缺失不影响书名作者', async () => {
    const buf = await makeZip({ 'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': OPF2 })
    const meta = await readEpubMeta(buf)
    expect(meta.title).toBe('门口的 野蛮人')
    expect(meta.cover).toBeUndefined()
  })

  it('坏文件给出明确错误：非 ZIP / 缺 container / 缺 OPF', async () => {
    await expect(readEpubMeta(new TextEncoder().encode('hello world').buffer)).rejects.toThrow('ZIP')
    await expect(readEpubMeta(await makeZip({ a: 'x' }))).rejects.toThrow('container')
    await expect(readEpubMeta(await makeZip({ 'META-INF/container.xml': CONTAINER }))).rejects.toThrow('OPF')
  })

  it('listZipEntries：能列出所有条目名', async () => {
    const e = listZipEntries(await makeZip({ 'a.txt': '1', 'dir/b.txt': '2' }))
    expect([...e.keys()]).toEqual(['a.txt', 'dir/b.txt'])
  })
})

describe('thumbSize', () => {
  it('按宽度等比缩小；不放大小图；非法尺寸返回 0', () => {
    expect(thumbSize(480, 720)).toEqual({ width: 144, height: 216 })
    expect(thumbSize(100, 150)).toEqual({ width: 100, height: 150 })
    expect(thumbSize(0, 10)).toEqual({ width: 0, height: 0 })
  })
})

/* ---------- 封面懒加载队列 ---------- */
function fakeIO(over: Partial<LibraryIO> = {}): LibraryIO {
  let clock = 0
  return {
    scopeKey: 't',
    syncPath: '/s',
    readMirror: async () => null,
    writeMirror: async () => {},
    readRemote: async () => null,
    writeRemote: async () => {},
    listFiles: async () => [],
    summaryNameOf: (n) => n,
    readBinary: async () => new ArrayBuffer(4),
    writeBinary: async () => {},
    getLocalCover: async () => null,
    putLocalCover: async () => {},
    deleteCovers: async () => {},
    now: () => ++clock, // 必须单调递增：条目合并以 updatedAt 为准，平局会偏向远端
    ...over,
  }
}

describe('createCoverLoader：WebDAV 未连接时', () => {
  it('云端封面（bk_）照常取：书架不依赖 WebDAV；不写本地缓存也不报错', async () => {
    const img = new Blob(['img'])
    const fetchCloud = vi.fn(async () => img)
    const loader = createCoverLoader({ getIO: () => null, fetchCloud })
    expect(await loader.load('bk_abcdef')).toBe(img)
    expect(fetchCloud).toHaveBeenCalledWith('bk_abcdef')
  })

  it('WebDAV 封面（旧的路径哈希键）仍然必须有 IO：没有就返回 null，且不记失败（连上后可重试）', async () => {
    let io: LibraryIO | null = null
    const readBinary = vi.fn(async () => new ArrayBuffer(4))
    const loader = createCoverLoader({ getIO: () => io })
    expect(await loader.load('legacykey')).toBeNull()
    io = fakeIO({ readBinary })
    expect(await loader.load('legacykey')).not.toBeNull() // 连上后同一个键能取到：之前的 null 没被当成失败缓存
    expect(readBinary).toHaveBeenCalledTimes(1)
  })

  it('有 IO 时本地命中仍优先（云端封面不重复请求）', async () => {
    const local = new Blob(['cached'])
    const fetchCloud = vi.fn()
    const loader = createCoverLoader({ getIO: () => fakeIO({ getLocalCover: async () => local }), fetchCloud })
    expect(await loader.load('bk_abcdef')).toBe(local)
    expect(fetchCloud).not.toHaveBeenCalled()
  })

  it('本地缓存写入失败不影响拿到封面', async () => {
    const loader = createCoverLoader({ getIO: () => fakeIO({ putLocalCover: async () => Promise.reject(new Error('quota')) }), fetchCloud: async () => new Blob(['x']) })
    expect(await loader.load('bk_abcdef')).not.toBeNull()
  })
})

describe('createCoverLoader（懒加载 + 并发限制）', () => {
  it('并发不超过上限：10 个不同封面同时请求，任一时刻在途 ≤ 2', async () => {
    let inFlight = 0
    let peak = 0
    const io = fakeIO({
      readBinary: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return new ArrayBuffer(4)
      },
    })
    const loader = createCoverLoader({ getIO: () => io, concurrency: 2 })
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => loader.load(`k${i}`)))
    expect(results.every(Boolean)).toBe(true)
    expect(peak).toBe(2)
  })

  it('云端封面键（bk_ 前缀）走云端取图：独立并发上限、不碰 WebDAV；取到写本地；取不到记失败不重试', async () => {
    const N = CLOUD_COVER_CONCURRENCY + 6 // 比上限多，才能测出「到顶且不超」
    let inFlight = 0
    let peak = 0
    const fetchCloud = vi.fn(async (id: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return id === 'bk_missing' ? null : new Blob(['img'])
    })
    const readBinary = vi.fn(async () => new ArrayBuffer(4))
    const put = vi.fn(async () => {})
    const loader = createCoverLoader({ getIO: () => fakeIO({ readBinary, putLocalCover: put }), fetchCloud })
    await Promise.all(Array.from({ length: N }, (_, i) => loader.load(`bk_${i}aaaaaa`)))
    expect(peak).toBe(CLOUD_COVER_CONCURRENCY)
    expect(CLOUD_COVER_CONCURRENCY).toBeGreaterThan(COVER_FETCH_CONCURRENCY) // 云端取图不该被 WebDAV 的保守并发拖住
    expect(readBinary).not.toHaveBeenCalled() // 云端封面不占 WebDAV
    expect(put).toHaveBeenCalledTimes(N)
    expect(await loader.load('bk_missing')).toBeNull()
    expect(await loader.load('bk_missing')).toBeNull()
    expect(fetchCloud.mock.calls.filter((c) => c[0] === 'bk_missing')).toHaveLength(1)
    // 旧的路径哈希键仍走 WebDAV
    await createCoverLoader({ getIO: () => fakeIO({ readBinary }), fetchCloud }).load('legacykey')
    expect(readBinary).toHaveBeenCalledTimes(1)
  })

  it('本地命中不走远端；远端取到后写入本地', async () => {
    const local = new Blob(['x'])
    const readBinary = vi.fn(async () => new ArrayBuffer(4))
    const hit = createCoverLoader({ getIO: () => fakeIO({ getLocalCover: async () => local, readBinary }) })
    expect(await hit.load('a')).toBe(local)
    expect(readBinary).not.toHaveBeenCalled()

    const put = vi.fn(async () => {})
    const miss = createCoverLoader({ getIO: () => fakeIO({ readBinary, putLocalCover: put }) })
    await miss.load('b')
    expect(put).toHaveBeenCalledWith('b', expect.any(Blob))
  })

  it('同一封面的并发请求合并；失败本会话内不重试', async () => {
    const readBinary = vi.fn(async () => new ArrayBuffer(4))
    const l = createCoverLoader({ getIO: () => fakeIO({ readBinary }) })
    await Promise.all([l.load('a'), l.load('a'), l.load('a')])
    expect(readBinary).toHaveBeenCalledTimes(1)

    const bad = vi.fn(async () => {
      throw new Error('404')
    })
    const f = createCoverLoader({ getIO: () => fakeIO({ readBinary: bad }) })
    expect(await f.load('x')).toBeNull()
    expect(await f.load('x')).toBeNull()
    expect(bad).toHaveBeenCalledTimes(1)
    f.forget('x')
    await f.load('x')
    expect(bad).toHaveBeenCalledTimes(2)
  })

  it('无封面键 / 无可用 IO：直接 null，不报错', async () => {
    const l = createCoverLoader({ getIO: () => null })
    expect(await l.load(undefined)).toBeNull()
    expect(await l.load('a')).toBeNull()
  })
})

/* ---------- 元数据补全 ---------- */
const entry = (path: string, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  path, size: 100, mtime: '', title: path.split('/').pop()!.replace(/\.[^.]+$/, ''), status: 'unprocessed', stale: true, missingScans: 0, updatedAt: 1, ...over,
})
async function seeded(paths: string[]) {
  const mirror = applyScan(emptyIndex(0), paths.map((p) => ({ path: p, size: 100, mtime: '' })), { now: 1, summaryNameOf: (n) => n, summaryNames: new Set() }).index
  return mirror
}

describe('fillLibraryMetadata', () => {
  it('补全书名/作者/页数/封面键，清 stale，且不动 lastOpenedAt；封面存本地并串行上传', async () => {
    const mirror = await seeded(['/s/a.epub'])
    const put = vi.fn(async () => {})
    const publish = vi.fn(async () => true)
    const io = fakeIO({ readMirror: async () => mirror, putLocalCover: put })
    const inspect = async (): Promise<Inspection> => ({ meta: { title: '真书名', author: '某作者', pages: 12 }, thumb: new Blob(['t']) })
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), { inspect, publishCover: publish })
    expect(r).toMatchObject({ total: 1, filled: 1, retryable: 0, skipped: 0 })
    const e = r.index!.entries['/s/a.epub']
    expect(e).toMatchObject({ title: '真书名', author: '某作者', pages: 12, stale: false, coverKey: bookIdOf('/s/a.epub') })
    expect(e.lastOpenedAt).toBeUndefined()
    expect(put).toHaveBeenCalledTimes(1)
    // 封面不再写 WebDAV，而是补传云端：id 由书名主干算出，元数据一并带上
    expect(publish).toHaveBeenCalledWith(bookIdOf('/s/a.epub'), expect.objectContaining({ stem: 'a', title: '真书名', author: '某作者', pages: 12 }), expect.any(Blob), { replace: false })
  })

  it('书被换过（catalogChanged）：补传时带 replace 覆盖旧封面；用模糊匹配得到的 catalogId，不按路径另算', async () => {
    const mirror = await seeded(['/s/a.epub', '/s/b.epub'])
    const publish = vi.fn(async () => true)
    const io = fakeIO({ readMirror: async () => mirror })
    const inspect = async (): Promise<Inspection> => ({ meta: { title: 'T' }, thumb: new Blob(['t']) })
    const entries = [
      { ...mirror.entries['/s/a.epub'], catalogId: 'bk_fuzzy01', catalogChanged: true },
      { ...mirror.entries['/s/b.epub'] }, // 普通的新书：不覆盖
    ]
    const r = await fillLibraryMetadata(io, entries, { inspect, publishCover: publish })
    expect(r.filled).toBe(2)
    const byId = Object.fromEntries(publish.mock.calls.map((c) => [c[0], c[3]]))
    expect(byId['bk_fuzzy01']).toEqual({ replace: true })
    expect(byId[bookIdOf('/s/b.epub')]).toEqual({ replace: false })
    expect(r.index!.entries['/s/a.epub'].coverKey).toBe('bk_fuzzy01') // 本地封面键也用云端 id
  })

  it('换过的书解析不出封面：仍补传元数据（带 replace 与新 size），否则云端记录永远是旧的、补全按钮消不掉', async () => {
    const mirror = await seeded(['/s/a.epub'])
    const publish = vi.fn(async () => true)
    const io = fakeIO({ readMirror: async () => mirror })
    const entries = [{ ...mirror.entries['/s/a.epub'], size: 777, catalogChanged: true }]
    await fillLibraryMetadata(io, entries, { inspect: async () => ({ meta: { title: 'T' }, thumb: null }), publishCover: publish })
    expect(publish).toHaveBeenCalledWith(bookIdOf('/s/a.epub'), expect.objectContaining({ size: 777 }), null, { replace: true })
  })

  it('补传明确失败（返回 false / 抛错）：计入 retryable，不悄悄当成功', async () => {
    const mirror = await seeded(['/s/a.epub', '/s/b.epub'])
    const io = fakeIO({ readMirror: async () => mirror })
    let n = 0
    const publish = vi.fn(async () => {
      if (n++ === 0) return false
      throw new Error('quota')
    })
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), { inspect: async () => ({ meta: { title: 'T' }, thumb: new Blob(['t']) }), publishCover: publish })
    expect(r.retryable).toBe(2)
  })

  it('txt/md 没有内嵌元数据：不下载、直接清 stale（不白白下载整本）', async () => {
    const mirror = await seeded(['/s/笔记.md', '/s/文稿.txt', '/s/书.epub'])
    const readBinary = vi.fn(async () => new ArrayBuffer(8))
    const io = fakeIO({ readMirror: async () => mirror, readBinary })
    const inspect = vi.fn(async (): Promise<Inspection> => ({ meta: { title: 'T' }, thumb: null }))
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), { inspect })
    expect(readBinary.mock.calls.map((c) => c[0])).toEqual(['/s/书.epub'])
    expect(r.index!.entries['/s/笔记.md'].stale).toBe(false)
    expect(r.index!.entries['/s/文稿.txt'].stale).toBe(false)
    expect(r.skipped).toBe(2)
  })

  it('"未知标题/未知作者"占位不覆盖文件名兜底', async () => {
    const mirror = await seeded(['/s/书.epub'])
    const io = fakeIO({ readMirror: async () => mirror })
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), {
      inspect: async () => ({ meta: { title: '未知标题', author: '未知作者' }, thumb: null }),
    })
    expect(r.index!.entries['/s/书.epub']).toMatchObject({ title: '书', author: undefined, stale: false })
  })

  it('下载失败 = 可重试（保持 stale）；解析失败/过大 = 确定性（清 stale，不再重复下载）', async () => {
    const mirror = await seeded(['/s/net.epub', '/s/bad.epub', '/s/huge.epub'])
    mirror.entries['/s/huge.epub'].size = 500
    const io = fakeIO({
      readMirror: async () => mirror,
      readBinary: async (p) => {
        if (p === '/s/net.epub') throw new Error('timeout')
        return new ArrayBuffer(4)
      },
    })
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), {
      maxBytes: 200,
      inspect: async () => {
        throw new Error('不是有效的 ZIP')
      },
    })
    expect(r).toMatchObject({ total: 3, retryable: 1, skipped: 2, filled: 0 })
    expect(r.index!.entries['/s/net.epub'].stale).toBe(true)
    expect(r.index!.entries['/s/bad.epub'].stale).toBe(false)
    expect(r.index!.entries['/s/huge.epub'].stale).toBe(false)
  })

  it('并发不超过 FILL_CONCURRENCY 且确实并行、可取消：取消后不再启动新的下载', async () => {
    const paths = Array.from({ length: FILL_CONCURRENCY * 4 }, (_, i) => `/s/b${i}.epub`)
    const mirror = await seeded(paths)
    let inFlight = 0
    let peak = 0
    const ac = new AbortController()
    let started = 0
    const io = fakeIO({
      readMirror: async () => mirror,
      readBinary: async () => {
        started++
        inFlight++
        peak = Math.max(peak, inFlight)
        if (started === FILL_CONCURRENCY + 1) ac.abort()
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return new ArrayBuffer(4)
      },
    })
    const r = await fillLibraryMetadata(io, Object.values(mirror.entries), { signal: ac.signal, inspect: async () => ({ meta: {}, thumb: null }) })
    expect(peak).toBeLessThanOrEqual(FILL_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // 没被意外串行化
    expect(r.cancelled).toBe(true)
    expect(started).toBeLessThan(paths.length)
  })

  it('只处理 stale 条目；进度回调逐本触发', async () => {
    const mirror = await seeded(['/s/a.epub', '/s/b.epub'])
    mirror.entries['/s/b.epub'].stale = false
    const progress: number[][] = []
    const r = await fillLibraryMetadata(fakeIO({ readMirror: async () => mirror }), Object.values(mirror.entries), {
      inspect: async () => ({ meta: {}, thumb: null }),
      onProgress: (d, t) => progress.push([d, t]),
    })
    expect(r.total).toBe(1)
    expect(progress).toEqual([[1, 1]])
  })
})

describe('补全后的索引随扫描保留元数据；GC 同步清理孤儿封面', () => {
  it('被 GC 的条目的封面键传给 deleteCovers', async () => {
    const files = [{ path: '/s/a.epub', basename: 'a.epub', size: 1, mtime: 'm' }]
    let remote: string | null = null
    let mirror: unknown = null
    const deleted: string[][] = []
    const io = fakeIO({
      readMirror: async () => mirror,
      writeMirror: async (i) => void (mirror = i),
      readRemote: async () => remote,
      writeRemote: async (t) => void (remote = t),
      listFiles: async () => files,
      deleteCovers: async (k) => void deleted.push(k),
    })
    await refreshLibrary(io)
    const idx = (mirror as { entries: Record<string, LibraryEntry> })
    idx.entries['/s/a.epub'].coverKey = 'ck1'
    files.length = 0
    await refreshLibrary(io)
    await refreshLibrary(io) // 第二次缺席 → GC
    expect(deleted.flat()).toEqual(['ck1'])
  })

  it('coverKeyOf 稳定且路径不同键不同', () => {
    expect(coverKeyOf('/s/a.epub')).toBe(coverKeyOf('/s/a.epub'))
    expect(coverKeyOf('/s/a.epub')).not.toBe(coverKeyOf('/s/b.epub'))
  })
  void entry
})
