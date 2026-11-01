import { describe, it, expect, vi } from 'vitest'
import { CONCURRENCY, listTree, MAX_DEPTH, MAX_DIRS, type ListDir } from '@/services/library/listTree'
import type { WebDAVFileInfo } from '@/services/webdav/types'

const file = (path: string): WebDAVFileInfo => ({ filename: path, basename: path.split('/').pop()!, lastmod: 'm', size: 1, type: 'file' })
const dir = (path: string): WebDAVFileInfo => ({ filename: path, basename: path.split('/').pop()!, lastmod: 'm', size: 0, type: 'directory' })

/** 假文件系统：children[目录] = 直接子项；deepStatus 控制 Depth:infinity 的结果 */
function fakeFs(children: Record<string, WebDAVFileInfo[]>, opts: { deepFails?: boolean; failDirs?: string[] } = {}) {
  const calls: { dir: string; deep: boolean }[] = []
  const flatten = (d: string): WebDAVFileInfo[] => (children[d] ?? []).flatMap((c) => (c.type === 'directory' ? [c, ...flatten(c.filename)] : [c]))
  const list: ListDir = async (d, deep) => {
    calls.push({ dir: d, deep })
    if (deep && opts.deepFails) return { success: false, error: '获取目录内容失败: Invalid response: 403' }
    if (opts.failDirs?.includes(d)) return { success: false, error: `获取目录内容失败: ${d}` }
    return { success: true, data: deep ? flatten(d) : (children[d] ?? []) }
  }
  return { list, calls }
}

describe('listTree', () => {
  it('深度列表可用：只发一次请求', async () => {
    const fs = fakeFs({ '/s': [file('/s/a.epub'), dir('/s/sub')], '/s/sub': [file('/s/sub/b.pdf')] })
    const out = await listTree(fs.list, '/s')
    expect(out.filter((f) => f.type === 'file').map((f) => f.filename).sort()).toEqual(['/s/a.epub', '/s/sub/b.pdf'])
    expect(fs.calls).toEqual([{ dir: '/s', deep: true }])
  })

  it('深度列表被 403 拒绝：退回逐层 Depth:1，仍能取全子目录里的书', async () => {
    const fs = fakeFs({ '/s': [file('/s/a.epub'), dir('/s/sub')], '/s/sub': [file('/s/sub/b.pdf'), dir('/s/sub/deep')], '/s/sub/deep': [file('/s/sub/deep/c.epub')] }, { deepFails: true })
    const out = await listTree(fs.list, '/s')
    expect(out.map((f) => f.filename).sort()).toEqual(['/s/a.epub', '/s/sub/b.pdf', '/s/sub/deep/c.epub'])
    expect(fs.calls.filter((c) => c.deep)).toHaveLength(1) // 只试一次深度
    expect(fs.calls.filter((c) => !c.deep).map((c) => c.dir)).toEqual(['/s', '/s/sub', '/s/sub/deep'])
  })

  it('根目录本身读不出来：抛错（带原因），不当作「没有书」', async () => {
    const fs = fakeFs({}, { deepFails: true, failDirs: ['/s'] })
    await expect(listTree(fs.list, '/s')).rejects.toThrow('/s')
  })

  it('某个子目录读不出来：整体抛错（残缺列表会让里面的书被当成已删除）', async () => {
    const fs = fakeFs({ '/s': [dir('/s/ok'), dir('/s/bad')], '/s/ok': [file('/s/ok/a.epub')], '/s/bad': [file('/s/bad/x.epub')] }, { deepFails: true, failDirs: ['/s/bad'] })
    await expect(listTree(fs.list, '/s')).rejects.toThrow('/s/bad')
  })

  it('子目录瞬时失败（如 429）：重试一次成功就不算失败', async () => {
    const calls: string[] = []
    const list: ListDir = async (d, deep) => {
      if (deep) return { success: false, error: '403' }
      calls.push(d)
      if (d === '/s/a' && calls.filter((c) => c === d).length === 1) return { success: false, error: '429' }
      return { success: true, data: d === '/s' ? [dir('/s/a')] : [file('/s/a/1.epub')] }
    }
    const out = await listTree(list, '/s')
    expect(out.map((f) => f.filename)).toEqual(['/s/a/1.epub'])
    expect(calls.filter((c) => c === '/s/a')).toHaveLength(2)
  })

  it('兜底遍历跳过点开头的目录（.juhua 的索引与封面里没有书）', async () => {
    const fs = fakeFs({ '/s': [dir('/s/.juhua'), file('/s/a.epub')], '/s/.juhua': [file('/s/.juhua/covers.webp')] }, { deepFails: true })
    await listTree(fs.list, '/s')
    expect(fs.calls.map((c) => c.dir)).not.toContain('/s/.juhua')
  })

  it(`层数有上限（${MAX_DEPTH} 层）：无限深的链不会无限请求`, async () => {
    const list = vi.fn<ListDir>(async (d) => ({ success: true, data: [dir(`${d}/n`)] }))
    const chain: ListDir = async (d, deep) => (deep ? { success: false, error: '403' } : list(d, deep))
    await listTree(chain, '/deep')
    expect(list.mock.calls.length).toBe(MAX_DEPTH + 1)
  })

  it(`目录数超过上限（${MAX_DIRS}）：抛错而不是返回残缺列表（残缺会让没扫到的书被 GC 误删）`, async () => {
    const wide: ListDir = async (d, deep) => {
      if (deep) return { success: false, error: '403' }
      return { success: true, data: d === '/w' ? Array.from({ length: MAX_DIRS + 50 }, (_, i) => dir(`/w/d${i}`)) : [] }
    }
    const spy = vi.fn(wide)
    await expect(listTree(spy, '/w')).rejects.toThrow('目录太多')
    expect(spy.mock.calls.filter(([, deep]) => !deep).length).toBeLessThanOrEqual(MAX_DIRS)
  })
  it(`兜底遍历并行：同层目录同时在飞，但不超过 ${CONCURRENCY} 路；输出顺序与串行一致`, async () => {
    const dirs = Array.from({ length: 20 }, (_, i) => `/s/d${String(i).padStart(2, '0')}`)
    const children: Record<string, WebDAVFileInfo[]> = { '/s': dirs.map(dir) }
    for (const d of dirs) children[d] = [file(`${d}/b.epub`)]
    let inFlight = 0
    let peak = 0
    const order: string[] = []
    const list: ListDir = async (d, deep) => {
      if (deep) return { success: false, error: '403' }
      inFlight++
      peak = Math.max(peak, inFlight)
      order.push(d)
      // 越靠前的目录越慢：并行下完成顺序会反过来，输出仍必须按目录顺序
      await new Promise((r) => setTimeout(r, d === '/s' ? 0 : 30 - Number(d.slice(-2))))
      inFlight--
      return { success: true, data: children[d] ?? [] }
    }
    const out = await listTree(list, '/s')
    expect(CONCURRENCY).toBeGreaterThanOrEqual(4) // 常量本身不能被悄悄改回串行
    expect(peak).toBe(CONCURRENCY)
    expect(out.map((f) => f.filename)).toEqual(dirs.map((d) => `${d}/b.epub`))
    expect(order[0]).toBe('/s')
  })

  it('并行下某个子目录持续失败：同样整体抛错', async () => {
    const fs = fakeFs({ '/s': [dir('/s/a'), dir('/s/b'), dir('/s/c')], '/s/a': [file('/s/a/1.epub')], '/s/b': [file('/s/b/2.epub')], '/s/c': [file('/s/c/3.epub')] }, { deepFails: true, failDirs: ['/s/b'] })
    await expect(listTree(fs.list, '/s')).rejects.toThrow('/s/b')
  })
})
