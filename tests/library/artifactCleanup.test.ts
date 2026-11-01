import { describe, it, expect, vi } from 'vitest'
import {
  classifyStaleArtifacts,
  classifyStalePackages,
  summarizeStale,
  type ListedArtifactFile,
  type ScannedEnvelopeFile,
  type ScannedPackage,
} from '@/services/library/artifactCleanup'
import {
  deleteStaleArtifacts,
  isArtifactPackageDir,
  scanStaleArtifacts,
  type ArtifactPackageIO,
} from '@/services/library/artifactCleanupService'
import { applyScan, emptyIndex, patchEntry } from '@/services/library/libraryIndex'
import { buildEnvelope, parseEnvelopeText, serializeEnvelope, type ArtifactKind as EnvelopeKind } from '@/services/artifacts/envelope'
import type { LibraryIO } from '@/services/library/libraryService'
import type { LibraryEntry, LibraryIndex } from '@/services/library/types'

const SYNC = '/fastReader'
const BOOKS_ROOT = `${SYNC}/.juhua/books`
const f = (name: string, size = 10, dir = SYNC): ListedArtifactFile => ({ path: `${dir}/${name}`, basename: name, size })
const summaryOf = (book: string) => `${book.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const live = (...books: string[]) => new Set(books.map(summaryOf))

const classify = (files: ListedArtifactFile[], books: string[] = []) => classifyStaleArtifacts({ files, liveSummaryNames: live(...books), syncPath: SYNC })
const view = (list: ReturnType<typeof classify>) => list.map((a) => `${a.basename}:${a.reason}:${a.recommended ? 'rec' : 'keep'}`)

describe('classifyStaleArtifacts：三级「过时」', () => {
  it('现役产物（书还在）一个都不报', () => {
    const files = [f('甲-完整摘要.md'), f('甲-完整摘要.json'), f('甲-完整摘要.meta.json')]
    expect(classify(files, ['甲.epub'])).toEqual([])
  })

  it('legacy：旧版逐章导出 / 旧思维导图，默认勾选', () => {
    const files = [f('甲_chapter_3_summary.md'), f('甲_chapter_3_mindmap.json', 5, `${SYNC}/甲/mindmaps`), f('甲_combined_mindmap.json', 5, `${SYNC}/甲`)]
    const out = classify(files, ['甲.epub'])
    expect(out).toHaveLength(3)
    expect(out.every((a) => a.reason === 'legacy' && a.recommended && a.kind === 'legacy')).toBe(true)
  })

  it('dangling：图表 / 旁路的主 MD 不在了 → 读不出来，默认勾选', () => {
    const files = [f('甲-完整摘要.json'), f('乙-完整摘要.meta.json')]
    expect(view(classify(files, ['甲.epub', '乙.epub']))).toEqual(['乙-完整摘要.meta.json:dangling:rec', '甲-完整摘要.json:dangling:rec'].sort((a, b) => a.localeCompare(b)))
  })

  it('orphan：主 MD 在但书不在 → 仅列出、默认不勾选；它的附件一并列出（保持成套）也不勾选', () => {
    const files = [f('丙-完整摘要.md'), f('丙-完整摘要.json'), f('丙-完整摘要.meta.json')]
    const out = classify(files, ['甲.epub'])
    expect(out).toHaveLength(3)
    expect(out.every((a) => a.reason === 'orphan' && !a.recommended)).toBe(true)
  })

  it('绝不碰：书本身、.juhua 下的索引与封面、不匹配命名的任意文件', () => {
    const files = [
      f('甲.epub'),
      f('笔记.md'),
      f('随手记.json'),
      f('library.json.gz', 10, `${SYNC}/.juhua`),
      f('bk_x.webp', 10, `${SYNC}/.juhua/covers`),
      // .juhua 下即使名字像产物也不碰
      f('丁_chapter_1_summary.md', 10, `${SYNC}/.juhua`),
    ]
    expect(classify(files, ['甲.epub'])).toEqual([])
  })

  it('排序稳定：同级按原因再按文件名；summarizeStale 汇总数量与体积', () => {
    const files = [f('乙_chapter_1_summary.md', 100), f('丙-完整摘要.md', 1000), f('甲-完整摘要.json', 10)]
    const out = classify(files, [])
    expect(out.map((a) => a.reason)).toEqual(['dangling', 'legacy', 'orphan'])
    const s = summarizeStale(out)
    expect(s).toMatchObject({ count: 3, bytes: 1110 })
    expect(s.byReason).toEqual({
      legacy: { count: 1, bytes: 100 },
      dangling: { count: 1, bytes: 10 },
      orphan: { count: 1, bytes: 1000 },
      stale: { count: 0, bytes: 0 },
    })
  })
})

describe('classifyStalePackages：信封包（整包 / 已过时）', () => {
  /** 造一个包内的信封文件；`schema` 传大于 ARTIFACT_SCHEMA 的值可造「更高版本」 */
  const envFile = (kind: EnvelopeKind, name: string, bookKey: string, inputsFp: string, opts: { schema?: number; parsed?: boolean } = {}): ScannedEnvelopeFile => {
    const [title, author] = bookKey.split('|')
    const raw = buildEnvelope({ kind, bookKey, title, author: author || undefined, inputsFp, data: {}, now: 1 })
    const text = serializeEnvelope(opts.schema ? { ...raw, schema: opts.schema } : raw)
    return {
      kind,
      path: `${BOOKS_ROOT}/甲~x/${name}`,
      basename: name,
      size: 10,
      parsed: opts.parsed === false ? null : parseEnvelopeText(text, kind),
    }
  }
  const pkg = (folder: string, files: ScannedEnvelopeFile[]): ScannedPackage => ({ path: `${BOOKS_ROOT}/${folder}`, folder, files })

  it('整包 orphan：书已不在 → 整包（目录）列出、默认不勾选、size 为包内合计', () => {
    const out = classifyStalePackages({
      packages: [pkg('乙~1', [envFile('study', 'study.json.gz', '乙|', 'fp'), envFile('quiz', 'quiz.json.gz', '乙|', 'fp')])],
      liveBooks: [{ title: '甲' }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ basename: '乙~1', dir: true, kind: 'artifact', reason: 'orphan', recommended: false, hasNotes: false, size: 20 })
  })

  it('含笔记的整包：警示 + 默认不勾选（笔记是用户亲手写的数据）', () => {
    const out = classifyStalePackages({
      packages: [pkg('乙~1', [envFile('notes', 'notes.json.gz', '乙|', '')])],
      liveBooks: [{ title: '甲' }],
    })
    expect(out[0]).toMatchObject({ reason: 'orphan', hasNotes: true, recommended: false, dir: true })
  })

  it('stale：书还在，但信封的 inputsFp 与当前总结指纹不符 → 只列这一份，默认不勾选（信封里带着答题记录）', () => {
    const out = classifyStalePackages({
      packages: [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|', '旧指纹')])],
      liveBooks: [{ title: '甲', studyFp: '新指纹' }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ basename: '甲~x/study.json.gz', reason: 'stale', recommended: false })
    expect(out[0].hasNotes).toBeUndefined()
    expect(out[0].dir).toBeUndefined()
  })

  it('指纹一致 / 索引里没有该书的指纹：都不算过时（无从判定就不动）', () => {
    const same = [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|', '新指纹')])]
    expect(classifyStalePackages({ packages: same, liveBooks: [{ title: '甲', studyFp: '新指纹' }] })).toEqual([])
    const noFp = [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|', '旧指纹')])]
    expect(classifyStalePackages({ packages: noFp, liveBooks: [{ title: '甲' }] })).toEqual([])
  })

  it('笔记永不判过时；整包含笔记也不影响同包其它份的判定（stale 只列那一份文件，碰不到笔记）', () => {
    const only = [pkg('甲~x', [envFile('notes', 'notes.json.gz', '甲|', '')])]
    expect(classifyStalePackages({ packages: only, liveBooks: [{ title: '甲', studyFp: '新指纹' }] })).toEqual([])
    const mixed = [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|', '旧指纹'), envFile('notes', 'notes.json.gz', '甲|', '')])]
    const out = classifyStalePackages({ packages: mixed, liveBooks: [{ title: '甲', studyFp: '新指纹' }] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ reason: 'stale', recommended: false })
  })

  it('读不懂就不动：读失败 / schema 更高 / 包内混着不认识的文件 → 整包都不列', () => {
    const books = [{ title: '乙' }]
    expect(
      classifyStalePackages({ packages: [pkg('乙~1', [envFile('study', 'study.json.gz', '乙|', 'fp', { parsed: false })])], liveBooks: books })
    ).toEqual([])
    expect(
      classifyStalePackages({ packages: [pkg('乙~1', [envFile('study', 'study.json.gz', '乙|', 'fp', { schema: 99 })])], liveBooks: books })
    ).toEqual([])
    const stray: ScannedEnvelopeFile = { kind: null, path: `${BOOKS_ROOT}/乙~1/readme.txt`, basename: 'readme.txt', size: 3, parsed: null }
    expect(classifyStalePackages({ packages: [pkg('乙~1', [envFile('study', 'study.json.gz', '乙|', 'fp'), stray])], liveBooks: books })).toEqual([])
  })

  it('匹配规则：精确 bookKey 优先；同书名不同作者绝不互相认领；只有作者一侧缺失才退化为按书名匹配', () => {
    // 精确命中：书在、指纹不符 → 单份「已过时」
    const byKey = classifyStalePackages({
      packages: [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|作者', '旧指纹')])],
      liveBooks: [{ title: '甲', author: '作者', studyFp: '新指纹' }],
    })
    expect(byKey[0]).toMatchObject({ reason: 'stale' })

    // 两侧都有作者且不同：不退化 —— 同书名不同作者是两本书，包对应的书确实不在，判整包（默认不勾选）
    const otherAuthor = classifyStalePackages({
      packages: [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|旧作者', '旧指纹')])],
      liveBooks: [{ title: '甲', author: '新作者', studyFp: '新指纹' }],
    })
    expect(otherAuthor).toHaveLength(1)
    expect(otherAuthor[0]).toMatchObject({ reason: 'orphan', dir: true, recommended: false })

    // 信封没写作者：可以退化为按书名匹配（所以不算「书已不在」），但指纹判定只认精确键 → 单份也不列
    const noAuthor = classifyStalePackages({
      packages: [pkg('甲~x', [envFile('study', 'study.json.gz', '甲|', '旧指纹')])],
      liveBooks: [{ title: '甲', author: '新作者', studyFp: '新指纹' }],
    })
    expect(noAuthor).toEqual([])
  })

  it('空包 / 没有任何一份能读懂：不列', () => {
    expect(classifyStalePackages({ packages: [pkg('乙~1', [])], liveBooks: [{ title: '甲' }] })).toEqual([])
  })
})

describe('scanStaleArtifacts：安全闸', () => {
  const sum = (n: string) => summaryOf(n)
  const indexOf = (...names: string[]) => applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index
  /** 索引里带书名 / 指纹：信封匹配用书名，过时判定用指纹 */
  const indexWith = (...books: { name: string; title?: string; studyFp?: string }[]): LibraryIndex => {
    let out = indexOf(...books.map((b) => b.name))
    for (const b of books) {
      const patch: Partial<LibraryEntry> = {}
      if (b.title) patch.title = b.title
      if (b.studyFp) patch.studyFp = b.studyFp
      if (Object.keys(patch).length) out = patchEntry(out, `/EBook/${b.name}`, patch, 1)
    }
    return out
  }
  const io = (files: ListedArtifactFile[]) => ({ syncPath: SYNC, summaryNameOf: sum, listFiles: async () => files.map((x) => ({ ...x, mtime: '' })) }) as unknown as LibraryIO

  it('同步目录里一本书都没扫到（多半目录配错）：拒绝给清单，不能据此判断「书都不在了」', async () => {
    const r = await scanStaleArtifacts(io([f('甲-完整摘要.md')]), emptyIndex(0), {})
    expect(r).toEqual({ ok: false, reason: 'no-books' })
  })

  it('云端书目里有记录的书不算「书已不在」（即使 WebDAV 上暂时没有这本书）', async () => {
    const files = [f('乙-完整摘要.md'), f('丙-完整摘要.md')]
    const r = await scanStaleArtifacts(io(files), indexOf('甲.epub'), { bk_b: { stem: '乙', title: '乙', file: '乙.epub' } })
    expect(r.ok && r.items.map((a) => a.basename)).toEqual(['丙-完整摘要.md']) // 乙有云端记录 → 现役；丙无任何痕迹 → orphan
  })

  it('只看同步目录之下的文件：书目录里的东西即使像产物也不进清单', async () => {
    const files = [f('丁_chapter_1_summary.md', 10, '/EBook')]
    const r = await scanStaleArtifacts(io(files), indexOf('甲.epub'), {})
    expect(r).toEqual({ ok: true, items: [] })
  })

  it('列目录失败：返回 scan-failed 与原因，不抛', async () => {
    const bad = { syncPath: SYNC, summaryNameOf: sum, listFiles: async () => Promise.reject(new Error('超时')) } as unknown as LibraryIO
    expect(await scanStaleArtifacts(bad, indexOf('甲.epub'), {})).toEqual({ ok: false, reason: 'scan-failed', error: '超时' })
  })

  /** 假的信封包 IO：目录树 = { bookFolder: { 文件名: 内容 | null(读失败) } } */
  const pkgIO = (tree: Record<string, Record<string, string | null>>, over: Partial<ArtifactPackageIO> = {}): ArtifactPackageIO => ({
    read: async (path) => {
      const parts = path.split('/')
      const text = tree[parts[parts.length - 2]]?.[parts[parts.length - 1]]
      if (text === undefined) return null
      if (text === null) throw new Error('读失败')
      return text
    },
    write: async () => false,
    removeDir: async () => true,
    listDirNames: async (dir) => (dir === BOOKS_ROOT ? Object.keys(tree) : []),
    list: async (dir) => {
      const folder = dir.split('/').pop() ?? ''
      const files = tree[folder]
      if (!files) return []
      return Object.keys(files).map((name) => ({ path: `${dir}/${name}`, basename: name, size: 5 }))
    },
    ...over,
  })
  const envText = (kind: EnvelopeKind, bookKey: string, inputsFp: string) => {
    const [title, author] = bookKey.split('|')
    return serializeEnvelope(buildEnvelope({ kind, bookKey, title, author: author || undefined, inputsFp, data: {}, now: 1 }))
  }

  it('信封包纳入扫描：书不在 → 整包 orphan；书在但指纹不符 → 单份 stale', async () => {
    const tree = {
      '乙~1': { 'study.json.gz': envText('study', '乙|', 'fp') },
      '甲~x': { 'study.json.gz': envText('study', '甲|', '旧'), 'notes.json.gz': envText('notes', '甲|', '') },
    }
    const r = await scanStaleArtifacts(io([]), indexWith({ name: '甲.epub', title: '甲', studyFp: '新' }), {}, pkgIO(tree))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items.map((a) => `${a.basename}:${a.reason}:${a.recommended ? 'rec' : 'keep'}`)).toEqual(['乙~1:orphan:keep', '甲~x/study.json.gz:stale:keep'])
  })

  it('包里混着子目录：整包删除是递归的，必须当作「不认识的东西」整包不动（独立审查 M5）', async () => {
    const tree = { '乙~1': { 'study.json.gz': envText('study', '乙|', 'fp') } }
    const withDir = pkgIO(tree, {
      list: async (dir) => [
        { path: `${dir}/study.json.gz`, basename: 'study.json.gz', size: 5 },
        { path: `${dir}/mine`, basename: 'mine', size: 0, isDir: true },
      ],
    })
    const r = await scanStaleArtifacts(io([]), indexWith({ name: '甲.epub', title: '甲' }), {}, withDir)
    // 乙 不在书架上，本应整包 orphan；因为含子目录，整包跳过
    expect(r.ok && r.items.map((a) => a.basename)).toEqual([])
  })

  it('单个包读失败不致命：其余包照常给出，整次扫描仍 ok', async () => {
    const tree = { '乙~1': { 'study.json.gz': null }, '丙~1': { 'study.json.gz': envText('study', '丙|', 'fp') } }
    const r = await scanStaleArtifacts(io([]), indexWith({ name: '甲.epub', title: '甲' }), {}, pkgIO(tree))
    expect(r.ok && r.items.map((a) => a.basename)).toEqual(['丙~1'])
  })

  it('包扫描整体不可用（列 .juhua/books 就失败）：旧式产物照常清理，不判 scan-failed', async () => {
    const boom = pkgIO({}, { listDirNames: async () => Promise.reject(new Error('目录不存在')) })
    const r = await scanStaleArtifacts(io([f('丙-完整摘要.md')]), indexWith({ name: '甲.epub', title: '甲' }), {}, boom)
    expect(r.ok && r.items.map((a) => a.basename)).toEqual(['丙-完整摘要.md'])
  })

  it('不传信封 IO（没连上 WebDAV）：只扫旧式产物', async () => {
    const r = await scanStaleArtifacts(io([f('丙-完整摘要.md')]), indexWith({ name: '甲.epub', title: '甲' }), {}, null)
    expect(r.ok && r.items.map((a) => a.basename)).toEqual(['丙-完整摘要.md'])
  })
})

describe('deleteStaleArtifacts', () => {
  const items = ['a', 'b', 'c', 'd'].map((n) => ({ path: `${SYNC}/${n}_chapter_1_summary.md`, basename: `${n}.md`, size: 1, kind: 'legacy', reason: 'legacy', recommended: true }) as never)

  it('逐个删除；单个失败不影响其余；返回成功与失败明细', async () => {
    const del = vi.fn(async (p: string) => (p.includes('/b_') ? { success: false, error: '403' } : { success: true }))
    const r = await deleteStaleArtifacts(items, del)
    expect(r.deleted).toHaveLength(3)
    expect(r.failed).toEqual([{ path: `${SYNC}/b_chapter_1_summary.md`, error: '403' }])
  })

  it('抛异常也只记为失败；并发不超过上限', async () => {
    let inFlight = 0
    let peak = 0
    const del = async (p: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      if (p.includes('/c_')) throw new Error('网络')
      return { success: true }
    }
    const r = await deleteStaleArtifacts(items, del, 2)
    expect(peak).toBeLessThanOrEqual(2)
    expect(r.failed).toEqual([{ path: `${SYNC}/c_chapter_1_summary.md`, error: '网络' }])
    expect(r.deleted).toHaveLength(3)
  })

  it('空列表：什么都不做', async () => {
    const del = vi.fn()
    expect(await deleteStaleArtifacts([], del)).toEqual({ deleted: [], failed: [] })
    expect(del).not.toHaveBeenCalled()
  })

  it('单文件删除也挡路径穿越：以同步目录开头但含 `..`（含 %2e%2e 编码）一律拒绝', async () => {
    const mk = (path: string) => ({ path, basename: 'x.md', size: 1, kind: 'legacy', reason: 'legacy', recommended: true }) as never
    const del = vi.fn(async () => ({ success: true }))
    const r = await deleteStaleArtifacts([mk(`${SYNC}/../别处/x.md`), mk(`${SYNC}/%2e%2e/别处/x.md`), mk(`${SYNC}/ok-完整摘要.md`)], del, 3, async () => ({ success: true }), SYNC)
    expect(del).toHaveBeenCalledTimes(1)
    expect(r.deleted).toHaveLength(1)
    expect(r.failed).toHaveLength(2)
  })

  it('整包（dir）走目录删除，不删单个文件', async () => {
    const item = { path: `${BOOKS_ROOT}/乙~1`, basename: '乙~1', size: 20, kind: 'artifact', reason: 'orphan', recommended: false, dir: true } as never
    const del = vi.fn(async () => ({ success: true }))
    const rmdir = vi.fn(async () => ({ success: true }))
    expect(await deleteStaleArtifacts([item], del, 3, rmdir)).toEqual({ deleted: [`${BOOKS_ROOT}/乙~1`], failed: [] })
    expect(rmdir).toHaveBeenCalledWith(`${BOOKS_ROOT}/乙~1`)
    expect(del).not.toHaveBeenCalled()
  })

  it('安全闸：整包只允许删 `.juhua/books/<单层目录>`，路径不对一律拒绝（宁可不删）', async () => {
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/乙~1`)).toBe(true)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/乙~1/`)).toBe(true)
    expect(isArtifactPackageDir(BOOKS_ROOT)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/a/b`)).toBe(false)
    expect(isArtifactPackageDir(`${SYNC}/别的目录`)).toBe(false)
    // `.` / `..` / 反斜杠：目录删除是递归的，这些只可能来自服务端返回的怪名字，一律不认
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/..`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/.`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/a\\b`)).toBe(false)
    // 百分号编码的路径穿越 / 编码过的分隔符：解码后不合法、或名字里还带 `%`，一律不认
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/%2e%2e`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/%2e`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/%2e%2e%2f`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/a%2fb`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/a%5cb`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/x%25`)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/%zz`)).toBe(false)
    // 给了同步目录：必须严格落在本次同步目录之下（换过同步目录的旧路径不认）
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/乙~1`, SYNC)).toBe(true)
    expect(isArtifactPackageDir(`/tmp${BOOKS_ROOT}/乙~1`, SYNC)).toBe(false)
    expect(isArtifactPackageDir(`${BOOKS_ROOT}/乙~1`, '/别的目录')).toBe(false)

    const bad = { path: `${SYNC}/别的目录`, basename: '别的目录', size: 1, kind: 'artifact', reason: 'orphan', recommended: false, dir: true } as never
    const del = vi.fn(async () => ({ success: true }))
    const rmdir = vi.fn(async () => ({ success: true }))
    const r = await deleteStaleArtifacts([bad], del, 3, rmdir)
    expect(r.deleted).toEqual([])
    expect(r.failed).toEqual([{ path: `${SYNC}/别的目录`, error: '路径不在产物目录内，已拒绝删除' }])
    expect(rmdir).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('安全闸：文件项也必须落在本次同步目录之下；越界的文件项与目录项都记 failed 不删', async () => {
    const del = vi.fn(async () => ({ success: true }))
    const rmdir = vi.fn(async () => ({ success: true }))
    const inside = { path: `${SYNC}/甲-完整摘要.md`, basename: '甲-完整摘要.md', size: 1, kind: 'summary', reason: 'orphan', recommended: false } as never
    const outside = { path: `/别的目录/甲-完整摘要.md`, basename: '甲-完整摘要.md', size: 1, kind: 'summary', reason: 'orphan', recommended: false } as never
    const r = await deleteStaleArtifacts([inside, outside], del, 3, rmdir, SYNC)
    expect(r.deleted).toEqual([`${SYNC}/甲-完整摘要.md`])
    expect(r.failed).toEqual([{ path: '/别的目录/甲-完整摘要.md', error: '路径不在产物目录内，已拒绝删除' }])
    expect(del).toHaveBeenCalledTimes(1)

    // 目录项同理：整包在别的同步目录下 / 更深一层，都不删
    const farDir = { path: `/tmp${BOOKS_ROOT}/乙~1`, basename: '乙~1', size: 20, kind: 'artifact', reason: 'orphan', recommended: false, dir: true } as never
    const deepDir = { path: `${BOOKS_ROOT}/乙~1/子目录`, basename: '子目录', size: 20, kind: 'artifact', reason: 'orphan', recommended: false, dir: true } as never
    const r2 = await deleteStaleArtifacts([farDir, deepDir], del, 3, rmdir, SYNC)
    expect(r2.deleted).toEqual([])
    expect(r2.failed.map((x) => x.path)).toEqual([`/tmp${BOOKS_ROOT}/乙~1`, `${BOOKS_ROOT}/乙~1/子目录`])
    expect(rmdir).not.toHaveBeenCalled()
  })
})
