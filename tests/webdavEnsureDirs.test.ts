/**
 * 上传前逐级创建祖先目录（真实 WebDAV 联调中暴露：标准服务器对缺少上级的 MKCOL 返回 409）
 * 用内存里的「严格 WebDAV」模拟：父目录不存在时 MKCOL 409、PUT 403，与 Apache mod_dav 一致。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { putFileContents, resetConfirmedDirs } from '../src/services/webdav/transfer'
import type { DavContext } from '../src/services/webdav/types'

function makeServer(initial: string[] = ['/base']) {
  const dirs = new Set<string>(['/', ...initial])
  const log: string[] = []
  const parentOf = (p: string) => p.substring(0, p.lastIndexOf('/')) || '/'
  let headerPath = '/'

  const ctx = {
    config: { serverUrl: 'https://dav.example/dav/', username: 'u', password: 'p', syncPath: '/base' },
    client: {
      createDirectory: async () => {
        log.push(`MKCOL ${headerPath}`)
        if (!dirs.has(parentOf(headerPath))) throw Object.assign(new Error('Conflict'), { status: 409 })
        dirs.add(headerPath)
      },
    },
    isBrowserProxyMode: () => true,
    runExclusive: <T>(fn: () => Promise<T>) => fn(),
    setDavHeader: (p: string) => {
      headerPath = p.replace(/\/$/, '') || '/'
    },
    proxyFetch: async (method: string, path: string) => {
      const p = path.replace(/\/$/, '') || '/'
      log.push(`${method} ${p}`)
      if (method === 'PROPFIND') return new Response(null, { status: dirs.has(p) ? 207 : 404 })
      if (method === 'PUT') {
        return new Response(null, { status: dirs.has(parentOf(p)) ? 201 : 403 })
      }
      return new Response(null, { status: 405 })
    },
  } as unknown as DavContext
  return { ctx, dirs, log }
}

describe('putFileContents：祖先目录逐级创建', () => {
  beforeEach(() => resetConfirmedDirs())

  it('两级都不存在时自顶向下创建，PUT 成功', async () => {
    const { ctx, dirs, log } = makeServer()
    const res = await putFileContents(ctx, '/base/book/mindmaps/m1.json', '{}', true)

    expect(res.success).toBe(true)
    expect(dirs.has('/base/book')).toBe(true)
    expect(dirs.has('/base/book/mindmaps')).toBe(true)
    const mkcols = log.filter((l) => l.startsWith('MKCOL'))
    expect(mkcols).toEqual(['MKCOL /base/book', 'MKCOL /base/book/mindmaps']) // 先上级后下级
  })

  it('已确认存在的目录不重复探测：同一本书的第二个文件不再 PROPFIND', async () => {
    const { ctx, log } = makeServer()
    await putFileContents(ctx, '/base/book/mindmaps/m1.json', '{}', true)
    const before = log.filter((l) => l.startsWith('PROPFIND')).length
    await putFileContents(ctx, '/base/book/mindmaps/m2.json', '{}', true)
    expect(log.filter((l) => l.startsWith('PROPFIND')).length).toBe(before)
  })

  it('目录已存在时不发 MKCOL', async () => {
    const { ctx, log } = makeServer(['/base', '/base/book', '/base/book/mindmaps'])
    const res = await putFileContents(ctx, '/base/book/mindmaps/m1.json', '{}', true)
    expect(res.success).toBe(true)
    expect(log.some((l) => l.startsWith('MKCOL'))).toBe(false)
  })

  it('目录被外部删除后：PUT 因 403 失败会清缓存，下一次重新探测并重建', async () => {
    const { ctx, dirs } = makeServer()
    await putFileContents(ctx, '/base/book/a.json', '{}', true)
    dirs.delete('/base/book') // 外部删除

    const failed = await putFileContents(ctx, '/base/book/b.json', '{}', true)
    expect(failed.success).toBe(false) // 缓存认为存在，PUT 被拒

    const retry = await putFileContents(ctx, '/base/book/b.json', '{}', true)
    expect(retry.success).toBe(true) // 缓存已清，重新创建
    expect(dirs.has('/base/book')).toBe(true)
  })

  it('不同账号的确认缓存互不影响', async () => {
    const a = makeServer()
    await putFileContents(a.ctx, '/base/book/x.json', '{}', true)

    const b = makeServer()
    ;(b.ctx.config as { username: string }).username = 'other'
    await putFileContents(b.ctx, '/base/book/x.json', '{}', true)
    expect(b.log.some((l) => l.startsWith('MKCOL'))).toBe(true) // 另一账号不会因 a 的缓存跳过创建
  })
})
