/**
 * 推理模型把 <think>…</think> 写进 content（实测 MiniMax-M3 经 OpenAI 兼容端点即如此）。
 * 不剥掉会进入章节摘要、导图 JSON 解析与缓存，污染每一本书。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { stripThinking } from '../src/services/ai/stripThinking'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'

describe('stripThinking', () => {
  it('剥掉开头的思考块', () => {
    expect(stripThinking('<think>先想想用户要什么</think>\n\n## 本章总结\n正文')).toBe('## 本章总结\n正文')
  })

  it('连续多段思考也能剥干净', () => {
    expect(stripThinking('<think>a</think><think>b</think>OK')).toBe('OK')
  })

  it('大小写与 thinking/reasoning 变体', () => {
    expect(stripThinking('<Thinking>x</Thinking>OK')).toBe('OK')
    expect(stripThinking('  <reasoning>x</reasoning>  OK')).toBe('OK')
  })

  it('正文中间提到 <think> 标签不动（书里可能在讨论它）', () => {
    const text = '本章介绍了 <think> 标签的用途。<think>示例</think>'
    expect(stripThinking(text)).toBe(text)
  })

  it('开头思考块未闭合（输出截断在思考阶段）→ 空串，交给上层按空内容失败重试', () => {
    expect(stripThinking('<think>想了很久还没想完')).toBe('')
  })

  it('无思考块原样返回；空串安全', () => {
    expect(stripThinking('普通正文')).toBe('普通正文')
    expect(stripThinking('')).toBe('')
  })
})

describe('OpenAIProvider 接入 stripThinking', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('返回给上层的 content 已剥掉思考过程', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '<think>We need answer OK</think>\n\nOK' }, finish_reason: 'stop' }],
            usage: { total_tokens: 12 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    const provider = new OpenAIProvider({
      provider: 'openai',
      providerId: 'p1',
      apiUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      temperature: 0.7,
    })
    const result = await provider.generateContent({ prompt: 'hi' })
    expect(result.content).toBe('OK')
  })
})
