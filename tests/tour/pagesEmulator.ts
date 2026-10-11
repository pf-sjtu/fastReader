/**
 * Cloudflare Pages Functions 的本机模拟（仅供 tests/tour 联调使用）。
 * 把 functions/ 下的 onRequest 包成本机 http 端点：Node 请求 → Request → onRequest → Response。
 * 浏览器里前端请求同源 /api/dav、/api/ai；联调测试里用它承接，真实经过项目自己的代理代码。
 */
import { createServer, type Server } from 'node:http'
import { Readable } from 'node:stream'

type Handler = (ctx: { request: Request; env: Record<string, string> }) => Promise<Response>

export interface EmulatorOptions {
  port: number
  /** 前端视角的 origin，同时作为代理的 ALLOWED_ORIGINS */
  origin: string
  /** 路径前缀 → onRequest，例如 { '/api/dav': davOnRequest } */
  routes: Record<string, Handler>
  /** 打印 方法 / 路径头 / 状态码（不含任何凭据） */
  trace?: boolean
}

export async function startPagesEmulator(opts: EmulatorOptions): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://localhost:${opts.port}`)
      const route = Object.keys(opts.routes).find((p) => url.pathname.startsWith(p))
      if (!route) {
        res.writeHead(404)
        res.end('no route')
        return
      }

      const method = req.method || 'GET'
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
        else if (v !== undefined) headers.set(k, v)
      }
      const hasBody = method !== 'GET' && method !== 'HEAD'
      const request = new Request(url, {
        method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        // @ts-expect-error Node fetch 流式请求体需要 duplex
        duplex: 'half',
      })

      const response = await opts.routes[route]({ request, env: { ALLOWED_ORIGINS: opts.origin } })
      if (opts.trace) {
        const target = headers.get('x-webdav-path') ?? url.searchParams.get('path') ?? '-'
        console.log(`[trace] ${method} ${route} ${target} -> ${response.status}`)
      }
      const out: Record<string, string> = {}
      response.headers.forEach((v, k) => (out[k] = v))
      res.writeHead(response.status, out)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  await new Promise<void>((resolve) => server.listen(opts.port, resolve))
  return server
}

/** 浏览器里的相对地址（/api/...）在 Node 的 fetch 中无法解析：补上 origin。返回还原函数 */
export function patchRelativeFetch(origin: string): () => void {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) input = origin + input
    return realFetch(input as RequestInfo, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}
