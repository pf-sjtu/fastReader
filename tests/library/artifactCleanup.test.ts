import { describe, it, expect, vi } from 'vitest'
import { classifyStaleArtifacts, summarizeStale, type ListedArtifactFile } from '@/services/library/artifactCleanup'
import { deleteStaleArtifacts, scanStaleArtifacts } from '@/services/library/artifactCleanupService'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'
import type { LibraryIO } from '@/services/library/libraryService'

const SYNC = '/fastReader'
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
    expect(s.byReason).toEqual({ legacy: { count: 1, bytes: 100 }, dangling: { count: 1, bytes: 10 }, orphan: { count: 1, bytes: 1000 } })
  })
})

describe('scanStaleArtifacts：安全闸', () => {
  const sum = (n: string) => summaryOf(n)
  const indexOf = (...names: string[]) => applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index
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
})
