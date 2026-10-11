/**
 * storage：webdavService —— existsStatus 三态与重试、路径不叠加 browsePath、单例随配置重建
 * 网络边界：mock 全局 fetch（代理直连）与 webdav 库 client；服务逻辑为真实代码
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const client = {
    headers: {} as Record<string, string>,
    setHeaders: vi.fn(),
    getHeaders: () => client.headers,
    getDirectoryContents: vi.fn(),
    exists: vi.fn(),
    createDirectory: vi.fn(),
    stat: vi.fn(),
    deleteFile: vi.fn(),
    putFileContents: vi.fn(),
    getFileContents: vi.fn(),
    // 每次请求发出时 X-WebDAV-Path 的快照
    paths: [] as string[]
  }
  client.setHeaders.mockImplementation((hd: Record<string, string>) => {
    client.headers = hd
    client.paths.push(hd['X-WebDAV-Path'])
  })
  return { client, createClient: vi.fn(() => client) }
})

vi.mock('webdav', () => ({ createClient: h.createClient }))

import {
  WebDAVService,
  bindWebDAVServiceToStore,
  classifyExistsStatus,
  getDavErrorStatus,
  describeConnectionError,
  EXISTS_MAX_ATTEMPTS
} from '../src/services/webdavService'
import { useWebDAVStore, defaultWebDAVConfig } from '../src/stores/webdav'
import type { WebDAVConfig } from '../src/stores/types'

const baseConfig: WebDAVConfig = {
  ...defaultWebDAVConfig,
  enabled: true,
  serverUrl: 'https://dav.example.com/dav/',
  username: 'u',
  password: 'p',
  syncPath: '/fastReader',
  browsePath: '/Books'
}

const fetchMock = vi.fn()
const res = (status: number, body = '') => new Response(status === 204 ? null : body, { status })
const lastFetch = (n = -1) => {
  const call = fetchMock.mock.calls.at(n)!
  const init = call[1] as RequestInit & { headers: Record<string, string> }
  return { method: init.method, path: decodeURIComponent(init.headers['X-WebDAV-Path']), headers: init.headers }
}
const davError = (status: number) => Object.assign(new Error(`Invalid response: ${status}`), { status })

async function ready(cfg: Partial<WebDAVConfig> = {}) {
  const svc = new WebDAVService()
  const r = await svc.initialize({ ...baseConfig, ...cfg })
  expect(r.success).toBe(true)
  h.client.paths.length = 0
  return svc
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  h.createClient.mockClear()
  h.client.paths.length = 0
  h.client.getDirectoryContents.mockReset().mockResolvedValue([])
  h.client.exists.mockReset().mockResolvedValue(true)
  h.client.createDirectory.mockReset().mockResolvedValue(true)
  h.client.stat.mockReset()
  h.client.deleteFile.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('状态分类工具', () => {
  it('classifyExistsStatus', () => {
    expect(classifyExistsStatus(200)).toBe('exists')
    expect(classifyExistsStatus(207)).toBe('exists')
    expect(classifyExistsStatus(404)).toBe('missing')
    expect(classifyExistsStatus(401)).toBe('unknown')
    expect(classifyExistsStatus(403)).toBe('unknown')
    expect(classifyExistsStatus(400)).toBe('unknown')
    expect(classifyExistsStatus(500)).toBe('retry')
    expect(classifyExistsStatus(503)).toBe('retry')
    expect(classifyExistsStatus(429)).toBe('retry')
    expect(classifyExistsStatus(undefined)).toBe('retry')
  })

  it('getDavErrorStatus 读 status / response.status', () => {
    expect(getDavErrorStatus(davError(404))).toBe(404)
    expect(getDavErrorStatus({ response: { status: 503 } })).toBe(503)
    expect(getDavErrorStatus(new TypeError('Failed to fetch'))).toBeUndefined()
    expect(getDavErrorStatus(null)).toBeUndefined()
    expect(getDavErrorStatus('x')).toBeUndefined()
  })

  it('describeConnectionError 按状态码分类，而非消息子串', () => {
    expect(describeConnectionError(davError(401))).toContain('认证失败')
    expect(describeConnectionError(davError(403))).toContain('访问被拒绝')
    expect(describeConnectionError(davError(404))).toContain('服务器地址不正确')
    expect(describeConnectionError(davError(405))).toContain('请求方法')
    expect(describeConnectionError(davError(502))).toContain('HTTP 502')
    expect(describeConnectionError(davError(418))).toBe('连接失败: HTTP 418')
    expect(describeConnectionError(new TypeError('Failed to fetch'))).toContain('网络连接失败')
    // 消息里含 "401" 但没有状态码：不再误判为认证失败
    expect(describeConnectionError(new Error('file 401.md broke'))).toBe('连接失败: file 401.md broke')
    expect(describeConnectionError(42)).toBe('连接失败: 未知错误')
  })
})

describe('existsStatus 三态与重试', () => {
  it('207 → exists，404 → missing，PROPFIND Depth:0', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(res(207))
    expect(await svc.existsStatus('/fastReader/a.md')).toBe('exists')
    expect(lastFetch()).toMatchObject({ method: 'PROPFIND', path: '/fastReader/a.md' })
    expect(lastFetch().headers.Depth).toBe('0')
    fetchMock.mockResolvedValueOnce(res(404))
    expect(await svc.existsStatus('/fastReader/b.md')).toBe('missing')
  })

  it('401/403 → unknown，不重试', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValue(res(403, 'Origin not allowed'))
    expect(await svc.existsStatus('/x')).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5xx 指数退避重试后成功', async () => {
    const svc = await ready()
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(207))
    const p = svc.existsStatus('/x')
    await vi.runAllTimersAsync()
    expect(await p).toBe('exists')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('网络错误重试耗尽 → unknown', async () => {
    const svc = await ready()
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const p = svc.existsStatus('/x')
    await vi.runAllTimersAsync()
    expect(await p).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(EXISTS_MAX_ATTEMPTS)
  })

  it('未初始化 → unknown', async () => {
    expect(await new WebDAVService().existsStatus('/x')).toBe('unknown')
  })

  it('exists / fileExists 兼容语义', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(res(207))
    expect(await svc.exists('/a')).toEqual({ success: true, data: true })
    fetchMock.mockResolvedValueOnce(res(404))
    expect(await svc.exists('/a')).toEqual({ success: true, data: false })
    fetchMock.mockResolvedValueOnce(res(401))
    expect(await svc.exists('/a')).toEqual({ success: false, error: '检查路径失败: HTTP 401' })
    fetchMock.mockResolvedValueOnce(res(401))
    expect(await svc.fileExists('/a')).toBe(false)
    fetchMock.mockResolvedValueOnce(res(207))
    expect(await svc.fileExists('/a')).toBe(true)
    expect(await new WebDAVService().exists('/a')).toEqual({ success: false, error: 'WebDAV客户端未初始化' })
  })
})

describe('路径：只用绝对路径，不叠加 browsePath', () => {
  it('同步/缓存类路径基于 syncPath，与 browsePath 无关', async () => {
    const svc = await ready({ browsePath: '/Books' })
    fetchMock.mockResolvedValueOnce(res(200, 'hello'))
    const r = await svc.getFileContents('/fastReader/书-完整摘要.md', 'text')
    expect(r).toEqual({ success: true, data: 'hello' })
    expect(lastFetch()).toMatchObject({ method: 'GET', path: '/fastReader/书-完整摘要.md' })
  })

  it('传入已含 browsePath 的路径不会再叠加（幂等）', async () => {
    const svc = await ready({ browsePath: '/Books' })
    fetchMock.mockResolvedValueOnce(res(200, 'x'))
    await svc.getFileContents('/Books/a.epub')
    expect(lastFetch().path).toBe('/Books/a.epub')
  })

  it('列目录：传入路径原样请求；空路径回落到 browsePath', async () => {
    const svc = await ready({ browsePath: '/Books' })
    h.client.getDirectoryContents.mockResolvedValue([
      { filename: 'https://dav.example.com/dav/Books/a.epub', basename: 'a.epub', lastmod: 'd', size: 3, type: 'file', etag: null, mime: 'x' },
      { filename: '/Books/sub', basename: 'sub', lastmod: 'd', size: 0, type: 'directory', etag: 'e' }
    ])
    const r = await svc.getDirectoryContents('/Books')
    expect(h.client.paths).toEqual(['/Books'])
    expect(r.data?.map((f) => f.filename)).toEqual(['/Books/a.epub', '/Books/sub'])
    expect(r.data?.[0].etag).toBeUndefined()
    await svc.getDirectoryContents('')
    expect(h.client.paths.at(-1)).toBe('/Books')
    const sup = await svc.getSupportedFiles('/Books')
    expect(sup.data?.map((f) => f.basename)).toEqual(['a.epub'])
  })

  it('上传：父目录 404 时 MKCOL，PUT 目标为绝对路径', async () => {
    const svc = await ready({ browsePath: '/Books' })
    fetchMock.mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(201))
    const r = await svc.uploadFile('/fastReader/a/b.md', '内容')
    expect(r).toEqual({ success: true, data: true })
    expect(lastFetch(0)).toMatchObject({ method: 'PROPFIND', path: '/fastReader/a' })
    expect(h.client.paths).toEqual(['/fastReader/a'])
    expect(h.client.createDirectory).toHaveBeenCalledTimes(1)
    expect(lastFetch()).toMatchObject({ method: 'PUT', path: '/fastReader/a/b.md' })
    expect(lastFetch().headers['Content-Length']).toBe(String(new TextEncoder().encode('内容').byteLength))
  })

  it('上传：父目录检查 unknown 时不 MKCOL，仍尝试 PUT；PUT 失败返回错误', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(res(403)).mockResolvedValueOnce(res(507, 'full'))
    const r = await svc.putFileContents('/fastReader/x.md', new ArrayBuffer(2), false)
    expect(h.client.createDirectory).not.toHaveBeenCalled()
    expect(r.success).toBe(false)
    expect(r.error).toContain('507')
    expect(lastFetch().headers['If-None-Match']).toBe('*')
  })

  it('下载失败与二进制下载', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(res(404))
    expect((await svc.getFileContents('/a')).error).toContain('404')
    fetchMock.mockResolvedValueOnce(res(500, 'boom'))
    expect((await svc.getFileContents('/a')).error).toContain('500')
    fetchMock.mockResolvedValueOnce(res(200, 'abc'))
    const f = await svc.downloadFileAsFile('../dav/Books/a.epub')
    expect(lastFetch().path).toBe('/Books/a.epub')
    expect(f.data?.name).toBe('a.epub')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await svc.getFileContents('/a')).success).toBe(false)
  })

  it('createDirectory / deleteFile / deleteDirectory / getStat 使用绝对路径', async () => {
    const svc = await ready({ browsePath: '/Books' })
    await svc.createDirectory('/fastReader/new')
    await svc.deleteFile('/fastReader/x.md')
    await svc.deleteDirectory('/fastReader/old')
    h.client.stat.mockResolvedValueOnce({ basename: 'x.md', lastmod: 'd', size: 5, type: 'file', etag: 'e', mime: 'm' })
    const st = await svc.getStat('/fastReader/x.md')
    expect(h.client.paths).toEqual(['/fastReader/new', '/fastReader/x.md', '/fastReader/old', '/fastReader/x.md'])
    expect(st.data).toMatchObject({ filename: '/fastReader/x.md', basename: 'x.md', size: 5, type: 'file' })
    h.client.deleteFile.mockRejectedValueOnce(davError(403))
    expect((await svc.deleteFile('/y')).success).toBe(false)
    h.client.stat.mockRejectedValueOnce(davError(404))
    expect((await svc.getStat('/y')).success).toBe(false)
  })

  it('ensureSyncDirectory / syncFiles / getFileDownloadLink', async () => {
    const svc = await ready()
    fetchMock
      .mockResolvedValueOnce(res(404)) // ensureSyncDirectory: /fastReader 不存在
      .mockResolvedValueOnce(res(207)) // PUT 前父目录检查
      .mockResolvedValueOnce(res(201)) // PUT
    const progress: number[] = []
    const r = await svc.syncFiles([{ name: 'a.json', content: '{}', path: 'b/a.json' }], (p) => progress.push(p))
    expect(r.success).toBe(true)
    expect(progress).toEqual([1])
    expect(lastFetch()).toMatchObject({ method: 'PUT', path: '/fastReader/b/a.json' })
    expect(svc.getFileDownloadLink('/x.md')).toContain(encodeURIComponent('/fastReader/x.md'))
    expect(new WebDAVService().getFileDownloadLink('/x')).toBe('')
  })
})

describe('initialize / testConnection', () => {
  it('配置不完整 → 失败', async () => {
    const r = await new WebDAVService().initialize({ ...baseConfig, password: '' })
    expect(r).toEqual({ success: false, error: 'WebDAV_CONFIG_INCOMPLETE' })
  })

  it('连接测试按状态码给出错误，并清空 client', async () => {
    h.client.getDirectoryContents.mockRejectedValueOnce(davError(401))
    const svc = new WebDAVService()
    const r = await svc.initialize(baseConfig)
    expect(r.error).toContain('认证失败')
    expect(svc.isInitialized()).toBe(false)
  })

  it('同步目录不存在时创建（基于 syncPath，不叠加 browsePath）', async () => {
    h.client.exists.mockResolvedValueOnce(false)
    await ready({ browsePath: '/Books' })
    expect(h.client.createDirectory).toHaveBeenCalledTimes(1)
  })

  it('相同凭据重复 initialize 不重建 client，但合并新 syncPath', async () => {
    const svc = await ready()
    await svc.initialize({ ...baseConfig, syncPath: '/other' })
    expect(h.createClient).toHaveBeenCalledTimes(1)
    expect(svc.getConfig()?.syncPath).toBe('/other')
    await svc.initialize({ ...baseConfig, password: 'p2' })
    expect(h.createClient).toHaveBeenCalledTimes(2)
  })

  it('未初始化时各操作返回错误', async () => {
    const svc = new WebDAVService()
    expect((await svc.testConnection()).success).toBe(false)
    expect((await svc.getDirectoryContents('/')).success).toBe(false)
    expect((await svc.getFileContents('/a')).success).toBe(false)
    expect((await svc.putFileContents('/a', 'x')).success).toBe(false)
    expect((await svc.createDirectory('/a')).success).toBe(false)
    expect((await svc.deleteFile('/a')).success).toBe(false)
    expect((await svc.deleteDirectory('/a')).success).toBe(false)
    expect((await svc.getStat('/a')).success).toBe(false)
    expect((await svc.ensureSyncDirectory()).success).toBe(false)
    expect((await svc.syncFiles([])).success).toBe(false)
    expect((await svc.downloadFileAsFile('/a')).success).toBe(false)
  })
})

describe('单例生命周期：随配置 store 变化', () => {
  it('凭据变化 → 断开（下次调用方会重新 initialize）；其他字段 → 合并', async () => {
    useWebDAVStore.setState({ webdavConfig: baseConfig })
    const svc = await ready()
    const unbind = bindWebDAVServiceToStore(svc)

    useWebDAVStore.getState().setWebDAVSyncPath('/newSync')
    expect(svc.isInitialized()).toBe(true)
    expect(svc.getConfig()?.syncPath).toBe('/newSync')

    useWebDAVStore.getState().setWebDAVConnectionStatus('connected')
    expect(svc.isInitialized()).toBe(true)

    useWebDAVStore.getState().setWebDAVPassword('changed')
    expect(svc.isInitialized()).toBe(false)
    expect(svc.getConfig()).toBeNull()

    // 未初始化时字段变化不报错
    useWebDAVStore.getState().setWebDAVBrowsePath('/z')
    unbind()
  })

  it('serverUrl / username 变化同样断开', async () => {
    useWebDAVStore.setState({ webdavConfig: baseConfig })
    const svc = await ready()
    const unbind = bindWebDAVServiceToStore(svc)
    useWebDAVStore.getState().setWebDAVServerUrl('https://other.example.com/dav/')
    expect(svc.isInitialized()).toBe(false)
    await svc.initialize({ ...baseConfig, serverUrl: 'https://other.example.com/dav/' })
    useWebDAVStore.getState().setWebDAVUsername('v')
    expect(svc.isInitialized()).toBe(false)
    unbind()
  })
})
