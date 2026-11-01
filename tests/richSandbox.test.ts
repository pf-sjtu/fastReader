import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOC_MSG, READY_MSG, SANDBOX_URL } from '@/lib/htmlSandbox'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('html 块沙箱页守卫', () => {
  const page = read('public/rich-sandbox/index.html')
  const headers = read('public/_headers')

  it('沙箱页的消息名与 htmlSandbox.ts 常量逐字一致，且脚本内联', () => {
    expect(page).toContain(`'${READY_MSG}'`)
    expect(page).toContain(`'${DOC_MSG}'`)
    expect(page).not.toMatch(/<script[^>]+src=/i)
    expect(page).toContain('e.source !== window.parent')
  })

  it('SANDBOX_URL 指向 public 下真实存在的页面', () => {
    // 必须是目录 URL：Cloudflare Pages 会把 /x.html 308 重定向到 /x，_headers 规则就匹配不到
    expect(SANDBOX_URL).toBe('/rich-sandbox/')
    expect(existsSync(resolve(__dirname, '..', 'public/rich-sandbox/index.html'))).toBe(true)
  })

  it('_headers：沙箱页摘掉全局 CSP 换成自己的——无网络、可内联脚本、只允许同源嵌套', () => {
    const i = headers.indexOf('\n/rich-sandbox/*')
    expect(i).toBeGreaterThan(-1)
    const rule = headers.slice(i + 1).split(/\n(?=\/)/)[0]
    expect(rule).toMatch(/^\s+! Content-Security-Policy/m)
    const csp = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(rule)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).not.toContain('connect-src')
  })

  it('全局 CSP 不放宽：不含 unsafe-inline 脚本', () => {
    const globalRule = headers.slice(0, headers.indexOf('\n/rich-sandbox/*'))
    const csp = /Content-Security-Policy:\s*(.+)/.exec(globalRule)?.[1] ?? ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })
})
