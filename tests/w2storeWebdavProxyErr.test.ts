/**
 * w2store：webdav 客户端侧对代理自身错误（X-Proxy-Error）的识别，以及拆分后各模块的补充覆盖
 * 网络边界：mock 全局 fetch 与 webdav 库 client
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  }
  client.setHeaders.mockImplementation((hd: Record<string, string>) => {
    client.headers = hd
  })
  return { client, createClient: vi.fn(() => client) }
})
vi.mock('webdav', () => ({ createClient: h.createClient }))

import { WebDAVService, classifyExistsStatus, describeConnectionError } from '../src/services/webdavService'
import { defaultWebDAVConfig } from '../src/stores/webdav'
import {
  describeProxyError,
  getProxyErrorReason,
  isProxyErrorResponse,
} from '../src/services/webdav/errors'
import { normalizeToArrayBuffer, basicAuthHeader, toUploadBody } from '../src/services/webdav/utils'
import { useAIConfigStore } from '../src/stores/ai-config'

const cfg = {
  ...defaultWebDAVConfig,
  enabled: true,
  serverUrl: 'https://dav.example.com/dav/',
  username: 'u',
  password: 'p',
  syncPath: '/fastReader',
}
const fetchMock = vi.fn()
const proxyRes = (status: number) =>
  new Response('x', { status, headers: { 'X-Proxy-Error': '1' } })

async function ready() {
  const svc = new WebDAVService()
  expect((await svc.initialize(cfg)).success).toBe(true)
  return svc
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  h.client.getDirectoryContents.mockReset().mockResolvedValue([])
  h.client.exists.mockReset().mockResolvedValue(true)
  h.client.createDirectory.mockReset().mockResolvedValue(true)
  h.client.stat.mockReset()
  h.client.putFileContents.mockReset().mockResolvedValue(true)
  h.client.getFileContents.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('代理自身错误的分类', () => {
  it('classifyExistsStatus：代理 404 不是 missing，代理 502 可重试，其余 unknown', () => {
    expect(classifyExistsStatus(404, true)).toBe('unknown')
    expect(classifyExistsStatus(403, true)).toBe('unknown')
    expect(classifyExistsStatus(502, true)).toBe('retry')
    expect(classifyExistsStatus(404, false)).toBe('missing')
  })

  it('describeProxyError 覆盖各状态码', () => {
    expect(describeProxyError(403)).toContain('Origin 不在白名单')
    expect(describeProxyError(400)).toContain('非法')
    expect(describeProxyError(405)).toContain('方法')
    expect(describeProxyError(413)).toContain('过大')
    expect(describeProxyError(502)).toContain('无法连接上游')
    expect(describeProxyError(418)).toContain('418')
    expect(describeProxyError(undefined)).toContain('未知')
  })

  it('getProxyErrorReason / describeConnectionError 读取库错误 response 头', () => {
    const mk = (status: number, proxy: boolean) =>
      Object.assign(new Error('x'), {
        status,
        response: { status, headers: { get: (n: string) => (proxy && n === 'X-Proxy-Error' ? '1' : null) } },
      })
    expect(getProxyErrorReason(mk(403, true))).toContain('Origin')
    expect(getProxyErrorReason(mk(403, false))).toBeUndefined()
    expect(getProxyErrorReason(null)).toBeUndefined()
    expect(describeConnectionError(mk(403, true))).toBe('代理拒绝：Origin 不在白名单')
    expect(describeConnectionError(mk(403, false))).toContain('访问被拒绝')
    expect(isProxyErrorResponse(proxyRes(403))).toBe(true)
    expect(isProxyErrorResponse(new Response('', { status: 403 }))).toBe(false)
  })
})

describe('existsStatus / exists 读取 X-Proxy-Error', () => {
  it('代理 403 → unknown，不重试，exists 报告明确原因', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValue(proxyRes(403))
    expect(await svc.existsStatus('/x')).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const r = await svc.exists('/x')
    expect(r.success).toBe(false)
    expect(r.error).toBe('检查路径失败: 代理拒绝：Origin 不在白名单')
  })

  it('代理 404（带标识）不会被当成 missing', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValue(proxyRes(404))
    expect(await svc.existsStatus('/x')).toBe('unknown')
  })

  it('代理 502 重试耗尽 → unknown 且原因为代理无法连接上游', async () => {
    const svc = await ready()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(proxyRes(502))
    const p = svc.exists('/x')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    const r = await p
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(r.error).toContain('代理无法连接上游')
  })

  it('上游自身 403 仍显示 HTTP 403', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValue(new Response('', { status: 403 }))
    expect((await svc.exists('/x')).error).toBe('检查路径失败: HTTP 403')
  })

  it('未初始化 → unknown', async () => {
    expect(await new WebDAVService().existsStatus('/x')).toBe('unknown')
  })
})

describe('下载/上传遇到代理错误', () => {
  it('GET 代理 403 给出代理原因；上游 404 仍是 404 文案', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(proxyRes(403))
    expect((await svc.getFileContents('/a.md', 'text')).error).toBe('下载文件失败: 代理拒绝：Origin 不在白名单')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    expect((await svc.getFileContents('/a.md', 'text')).error).toContain('404')
    fetchMock.mockResolvedValueOnce(proxyRes(404))
    expect((await svc.getFileContents('/a.md')).error).toContain('代理错误')
  })

  it('GET 成功 text/binary；上游 500 带响应体', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(new Response('hello'))
    expect((await svc.getFileContents('/a.md', 'text')).data).toBe('hello')
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    expect(((await svc.getFileContents('/a.bin')).data as ArrayBuffer).byteLength).toBe(3)
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    expect((await svc.getFileContents('/a.md')).error).toContain('500')
  })

  it('PUT 代理 413 给出代理原因；成功时父目录缺失会 MKCOL', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 })) // 探测父目录缺失
    fetchMock.mockResolvedValueOnce(proxyRes(413)) // PUT
    const r = await svc.putFileContents('/fastReader/sub/a.md', 'x')
    expect(h.client.createDirectory).toHaveBeenCalledTimes(1)
    expect(r.error).toBe('上传文件失败: 代理拒绝：请求体过大')

    fetchMock.mockResolvedValueOnce(new Response('', { status: 207 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }))
    expect((await svc.putFileContents('/fastReader/sub/b.md', new Blob(['x']), false)).success).toBe(true)
    const init = fetchMock.mock.calls.at(-1)![1] as RequestInit & { headers: Record<string, string> }
    expect(init.headers['If-None-Match']).toBe('*')
  })

  it('PUT 上游 507 带响应体；fetch 抛错被捕获', async () => {
    const svc = await ready()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 207 }))
    fetchMock.mockResolvedValueOnce(new Response('full', { status: 507 }))
    expect((await svc.putFileContents('/fastReader/a.md', 'x')).error).toContain('507')
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect((await svc.putFileContents('/a.md', 'x')).error).toContain('offline')
  })
})

describe('库直连路径（非浏览器代理模式）', () => {
  it('getFileContents / putFileContents / exists 走 webdav 库', async () => {
    const svc = await ready()
    const proto = WebDAVService.prototype as unknown as { isBrowserProxyMode(): boolean }
    const spy = vi.spyOn(proto, 'isBrowserProxyMode').mockReturnValue(false)
    try {
      h.client.getFileContents.mockResolvedValueOnce('txt').mockResolvedValueOnce(new Uint8Array([9, 8]))
      expect((await svc.getFileContents('/a.md', 'text')).data).toBe('txt')
      expect(((await svc.getFileContents('/a.bin')).data as ArrayBuffer).byteLength).toBe(2)
      h.client.getFileContents.mockRejectedValueOnce(new Error('Invalid response: 404'))
      expect((await svc.getFileContents('/a.md')).success).toBe(false)

      h.client.stat.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      expect((await svc.putFileContents('/fastReader/sub/a.md', 'x')).success).toBe(true)
      expect(h.client.createDirectory).toHaveBeenCalledTimes(1)
      expect(h.client.putFileContents).toHaveBeenCalledTimes(1)

      h.client.stat.mockResolvedValueOnce({})
      expect(await svc.existsStatus('/x')).toBe('exists')
      h.client.stat.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          status: 403,
          response: { status: 403, headers: { get: () => '1' } },
        })
      )
      expect((await svc.exists('/x')).error).toContain('代理拒绝')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('utils', () => {
  it('normalizeToArrayBuffer 覆盖各输入形态', async () => {
    const ab = new Uint8Array([1, 2]).buffer
    expect(await normalizeToArrayBuffer(ab)).toBe(ab)
    expect((await normalizeToArrayBuffer(new Uint8Array([1, 2, 3]).subarray(1))).byteLength).toBe(2)
    expect((await normalizeToArrayBuffer(new Blob(['abc']))).byteLength).toBe(3)
    expect((await normalizeToArrayBuffer(btoa('abcd'))).byteLength).toBe(4)
  })

  it('basicAuthHeader 非 latin1 兜底；toUploadBody 三种输入', () => {
    expect(basicAuthHeader('u', 'p')).toBe('Basic ' + btoa('u:p'))
    expect(basicAuthHeader('用户', 'p').startsWith('Basic ')).toBe(true)
    expect(toUploadBody('中').byteLength).toBe(3)
    expect(toUploadBody(new ArrayBuffer(4)).byteLength).toBe(4)
    expect(toUploadBody(new Blob(['x'])).byteLength).toBeUndefined()
  })
})

describe('ai-config：duplicate / template 返回新 provider 的 1-based 序号', () => {
  it('duplicateAIProvider 返回新序号并切换为当前模型；越界 -1', () => {
    const s = useAIConfigStore.getState()
    const before = s.aiConfigManager.providers.length
    const idx = s.duplicateAIProvider(1)
    expect(idx).toBe(before + 1)
    const st = useAIConfigStore.getState().aiConfigManager
    expect(st.providers.length).toBe(before + 1)
    expect(st.currentModelId).toBe(idx)
    expect(useAIConfigStore.getState().duplicateAIProvider(999)).toBe(-1)
  })

  it('createAIProviderFromTemplate 返回新序号；未知模板 -1', () => {
    const s = useAIConfigStore.getState()
    const before = s.aiConfigManager.providers.length
    expect(s.createAIProviderFromTemplate('openai')).toBe(before + 1)
    expect(useAIConfigStore.getState().aiConfigManager.providers.length).toBe(before + 1)
    expect(
      useAIConfigStore.getState().createAIProviderFromTemplate('nope' as unknown as 'openai')
    ).toBe(-1)
  })
})
