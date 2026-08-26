import { describe, it, expect } from 'vitest'
import {
  formatGeminiResponseParseError,
  shouldUseGeminiNodeProxy,
} from '../../src/services/ai/geminiProvider'

describe('shouldUseGeminiNodeProxy', () => {
  const ready = {
    proxyEnabled: true,
    proxyUrl: 'http://127.0.0.1:7890',
    isBrowser: false,
    proxyAgentAvailable: true,
  }

  it('agent 可用时走 Node 代理', () => {
    expect(shouldUseGeminiNodeProxy(ready)).toBe(true)
  })

  it('代理模块缺失时不走代理（避免递归回退）', () => {
    expect(shouldUseGeminiNodeProxy({ ...ready, proxyAgentAvailable: false })).toBe(false)
  })

  it('浏览器环境不走 Node 代理', () => {
    expect(shouldUseGeminiNodeProxy({ ...ready, isBrowser: true })).toBe(false)
  })

  it('未启用或无 URL 时不走代理', () => {
    expect(shouldUseGeminiNodeProxy({ ...ready, proxyEnabled: false })).toBe(false)
    expect(shouldUseGeminiNodeProxy({ ...ready, proxyUrl: '' })).toBe(false)
  })
})

describe('formatGeminiResponseParseError', () => {
  it('包含解析原因与 body 摘要', () => {
    const msg = formatGeminiResponseParseError(
      new Error('Unexpected token <'),
      '<html>upstream 502</html>'
    )
    expect(msg).toContain('Unexpected token <')
    expect(msg).toContain('<html>upstream 502</html>')
  })

  it('截断过长 body', () => {
    const msg = formatGeminiResponseParseError(new Error('bad json'), 'x'.repeat(500))
    expect(msg.length).toBeLessThan(300)
    expect(msg).toContain('body=')
  })
})
