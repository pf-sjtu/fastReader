/**
 * 测试辅助：把「非流式」的假响应转换成对应的流式响应。
 *
 * 各 provider 现在默认走流式（修 Cloudflare 524），既有用例里 `ok({...})` 造的一次性 JSON
 * 响应会让 provider 判定「流式无数据」。这里按协议把同一份逻辑内容拆成 SSE 帧，
 * 用例只需把 `ok(body)` 换成 `sseOk(body)`，断言语义不变。
 */
import type { Mock } from 'vitest'

const enc = new TextEncoder()

function sseResponse(text: string, contentType = 'text/event-stream'): Response {
  return new Response(text, { status: 200, headers: { 'content-type': contentType } })
}

const frame = (obj: unknown) => `data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`

/** OpenAI 兼容：choices[0].message.content → delta 帧；finish_reason 与 usage 照搬 */
export function sseOk(body: {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}): Response {
  const choice = body.choices?.[0]
  const frames = [frame({ choices: [{ delta: { content: choice?.message?.content ?? '' } }] })]
  frames.push(frame({ choices: [{ delta: {}, finish_reason: choice?.finish_reason ?? 'stop' }] }))
  if (body.usage) frames.push(frame({ choices: [], usage: body.usage }))
  frames.push(frame('[DONE]'))
  return sseResponse(frames.join(''))
}

/** Anthropic：content 里的 text 块 → content_block_delta；stop_reason 与 usage 走 message_delta */
export function sseAnthropicOk(body: {
  content?: Array<{ type: string; text?: string; thinking?: string }>
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}): Response {
  const frames = [frame({ type: 'message_start', message: { usage: { input_tokens: body.usage?.input_tokens ?? 0, output_tokens: 0 } } })]
  for (const block of body.content ?? []) {
    if (block.type === 'text' && block.text) {
      frames.push(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text } }))
    } else if (block.type === 'thinking') {
      // thinking 块：解析器只取 text_delta，这里故意发一个非 text 的 delta 验证不会被放进正文
      frames.push(frame({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: block.thinking ?? '' } }))
    }
  }
  frames.push(frame({
    type: 'message_delta',
    delta: { stop_reason: body.stop_reason ?? 'end_turn' },
    usage: { output_tokens: body.usage?.output_tokens ?? 0 },
  }))
  frames.push(frame({ type: 'message_stop' }))
  return sseResponse(frames.join(''))
}

/** Gemini：candidates[0].content.parts → 每块一帧；usageMetadata 照搬 */
export function sseGeminiOk(body: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  usageMetadata?: { totalTokenCount?: number }
}): Response {
  const candidate = body.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const frames = parts.map((part) => frame({ candidates: [{ content: { parts: [part] } }] }))
  frames.push(frame({ candidates: [{ content: { parts: [] }, finishReason: candidate?.finishReason ?? 'STOP' }], usageMetadata: body.usageMetadata }))
  return sseResponse(frames.join(''))
}

/** 让 fetch mock 返回这些流式响应的便捷包装（保持调用顺序） */
export function mockStreaming(f: Mock, ...responses: Response[]): Mock {
  for (const r of responses) f.mockResolvedValueOnce(r)
  return f
}
