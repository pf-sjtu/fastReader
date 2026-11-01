// 静态服务器：服务 dist，并按 public/_headers 的规则加响应头（含 Cloudflare 的「! Header」移除语法），
// 用来在真实浏览器里复现线上 CSP。用法：node tests/tour/richDemo/serve.mjs <dist 目录> <端口>
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const dist = resolve(process.argv[2] ?? 'tmp/rich-demo-dist')
const port = Number(process.argv[3] ?? 5198)
const rules = []
let cur = null
for (const line of readFileSync(resolve('public/_headers'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue
  if (!/^\s/.test(line)) {
    cur = { pattern: line.trim(), set: [], remove: [] }
    rules.push(cur)
  } else if (line.trim().startsWith('!')) cur.remove.push(line.trim().slice(1).trim().toLowerCase())
  else {
    const i = line.indexOf(':')
    cur.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
  }
}
const match = (pattern, path) =>
  pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path
// Cloudflare Pages 会把 /x.html 308 到 /x：模拟它，才能测出 _headers 规则是否真的命中
const REDIRECT = (p) => (p.endsWith('.html') && p !== '/index.html' ? p.slice(0, -5) : null)

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
http
  .createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const to = REDIRECT(path)
    if (to) {
      res.writeHead(308, { location: to })
      return res.end()
    }
    let file = join(dist, path === '/' ? 'index.html' : path)
    if (existsSync(file) && statSync(file).isDirectory() && existsSync(join(file, 'index.html'))) file = join(file, 'index.html')
    else if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
    const headers = {}
    // 调试入口：/__t/<文件>?csp=<原样 CSP>（省略 csp 则不带 CSP 头）——用来二分 CSP 的哪一项在沙箱里起作用
    if (path.startsWith('/__t/')) {
      const f = join(dist, path.slice(5))
      const q = new URL(req.url, 'http://x').searchParams
      const h = { 'content-type': types[extname(f)] ?? 'text/plain' }
      if (q.has('csp')) h['content-security-policy'] = q.get('csp')
      res.writeHead(200, h)
      return res.end(readFileSync(f))
    }
    for (const r of rules) {
      if (!match(r.pattern, path)) continue
      for (const h of r.remove) delete headers[h]
      for (const [k, v] of r.set) {
        const key = k.toLowerCase()
        headers[key] = headers[key] ? `${headers[key]}, ${v}` : v // Pages：同名头合并
      }
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', ...headers })
    res.end(readFileSync(file))
  })
  .listen(port, () => console.log(`serving ${dist} on http://localhost:${port}`))
