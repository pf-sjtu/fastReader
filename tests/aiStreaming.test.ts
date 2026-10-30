/**
 * 流式解析（修 524）：Cloudflare 同源代理对「上游 100 秒内没响应」返回 524 HTML 错误页，
 * 长章节（推理模型 2–5 分钟）非流式必然踩线。改流式后首个数据块立刻返回。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isStreamUnsupportedError,
  parseAnthropicStream,
  parseGeminiStream,
  parseOllamaStream,
  parseOpenAIStream,
  readLines,
} from '../src/services/ai/streamParse'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { GeminiProvider } from '../src/services/ai/geminiProvider'
import { OllamaProvider } from '../src/services/ai/ollamaProvider'

afterEach(() => vi.unstubAllGlobals())

/** 把文本做成流式 Response（按给定的切割方式分块，模拟网络分包） */
function streamResponse(text: string, { chunkSize = 7, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder()
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= text.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(text.slice(offset, offset + chunkSize)))
      offset += chunkSize
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

const sse = (events: unknown[]) =>
  events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')

const cfg = { apiUrl: 'https://x.test/v1', model: 'm', temperature: 0.3 }
const sentBody = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(f.mock.calls[i][1].body))

describe('readLines：跨块切分也能逐行还原', () => {
  it('CRLF 与半行都能正确处理', async () => {
    const lines: string[] = []
    await readLines(streamResponse('a\r\nb\n\nc', { chunkSize: 1 }).body, (l) => lines.push(l))
    expect(lines).toEqual(['a', 'b', '', 'c'])
  })
})

describe('OpenAI 兼容流', () => {
  const chunks = sse([
    { choices: [{ delta: { content: '本章' } }] },
    { choices: [{ delta: { content: '总结' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
    '[DONE]',
  ])

  it('累加 delta、取 finish_reason 与末尾 usage', async () => {
    const r = await parseOpenAIStream(streamResponse(chunks))
    expect(r.content).toBe('本章总结')
    expect(r.finishReason).toBe('stop')
    expect(r.usage).toEqual({ prompt: 100, completion: 20, total: 120 })
    expect(r.unsupported).toBe(false)
  })

  it('无 usage（网关不回 stream_options）也能拿到正文', async () => {
    const r = await parseOpenAIStream(streamResponse(sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] }])))
    expect(r.content).toBe('x')
    expect(r.usage).toBeUndefined()
    expect(r.finishReason).toBe('length')
  })

  it('剥掉 <think> 后返回（与 SkeletonProvider 一致）', async () => {
    const f = vi.fn(async () => streamResponse(sse([
      { choices: [{ delta: { content: '<think>思考</think>正文' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])))
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider({ ...cfg, provider: 'openai' }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('正文')
    // 请求带 stream:true 与 include_usage
    expect(sentBody(f).stream).toBe(true)
    expect(sentBody(f).stream_options).toEqual({ include_usage: true })
  })

  it('网关不认 stream_options：去掉后重试成功', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }), { status: 400 }))
      .mockImplementation(async () => streamResponse(sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])))
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider({ ...cfg, provider: 'openai' }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('ok')
    expect(sentBody(f, 1).stream).toBe(true)
    expect(sentBody(f, 1)).not.toHaveProperty('stream_options')
  })

  it('网关完全不支持流式：退回一次性 JSON', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'stream is not supported by this endpoint' } }), { status: 400 }))
      .mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '一次性' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', f)
    const r = await new OpenAIProvider({ ...cfg, provider: 'openai' }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('一次性')
    expect(sentBody(f, 1)).not.toHaveProperty('stream')
  })
})

describe('Anthropic 流', () => {
  it('content_block_delta 累加，message_delta 给 stop_reason 与 usage；max_tokens 映射为 length', async () => {
    const body = sse([
      { type: 'message_start', message: { usage: { input_tokens: 200, output_tokens: 1 } } },
      { type: 'ping' },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '不该进正文' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '本章' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '总结' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 50 } },
      { type: 'message_stop' },
    ])
    const r = await parseAnthropicStream(streamResponse(body))
    expect(r.content).toBe('本章总结')
    expect(r.finishReason).toBe('length')
    expect(r.usage).toEqual({ prompt: 200, completion: 50, total: 250 })
  })

  it('provider 请求体带 stream:true，正文只含 text 块', async () => {
    const f = vi.fn(async () => streamResponse(sse([
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '正文' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ])))
    vi.stubGlobal('fetch', f)
    const r = await new AnthropicProvider({ ...cfg, provider: 'anthropic', maxOutputTokens: 64000 }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('正文')
    expect(r.tokenCount).toBe(15)
    expect(sentBody(f).stream).toBe(true)
  })
})

describe('Gemini 流', () => {
  it('走 streamGenerateContent?alt=sse，累加 parts 文本', async () => {
    const f = vi.fn(async () => streamResponse(sse([
      { candidates: [{ content: { parts: [{ text: '答案' }] } }] },
      { candidates: [{ content: { parts: [{ text: '在此' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 42 } },
    ])))
    vi.stubGlobal('fetch', f)
    const r = await new GeminiProvider({ ...cfg, provider: 'gemini' }).generateContent({ prompt: 'p' })
    expect(r.content).toBe('答案在此')
    expect(r.tokenCount).toBe(42)
    expect(String(f.mock.calls[0][0])).toContain('streamGenerateContent?alt=sse')
  })
})

describe('Ollama 流', () => {
  it('NDJSON 逐行累加，done_reason 作为 finishReason', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '甲' }, done: false }),
      JSON.stringify({ message: { content: '乙' }, done: true, done_reason: 'length', prompt_eval_count: 30, eval_count: 12 }),
    ].join('\n') + '\n'
    const r = await parseOllamaStream(streamResponse(ndjson, { contentType: 'application/x-ndjson' }))
    expect(r.content).toBe('甲乙')
    expect(r.finishReason).toBe('length')
    expect(r.usage).toEqual({ prompt: 30, completion: 12, total: 42 })
  })

  it('请求体 stream:true', async () => {
    const f = vi.fn(async () => streamResponse(JSON.stringify({ message: { content: 'ok' }, done: true }) + '\n'))
    vi.stubGlobal('fetch', f)
    await new OllamaProvider({ ...cfg, provider: 'ollama' }).generateContent({ prompt: 'p' })
    expect(sentBody(f).stream).toBe(true)
  })
})

describe('流式不支持的错误识别', () => {
  it('只认 stream 相关参数被拒，其他 400 不算', () => {
    expect(isStreamUnsupportedError(400, 'stream is not supported by this endpoint')).toBe(true)
    expect(isStreamUnsupportedError(400, 'Unrecognized request argument supplied: stream_options')).toBe(true)
    expect(isStreamUnsupportedError(400, 'invalid api key')).toBe(false)
    expect(isStreamUnsupportedError(429, 'stream')).toBe(false)
  })
})
