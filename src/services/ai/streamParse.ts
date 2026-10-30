/**
 * 流式响应解析（SSE / NDJSON）。
 *
 * 为什么必须流式：网页端所有 AI 请求都经 Cloudflare Pages Functions 同源代理，Cloudflare 对
 * 「上游在 100 秒内没有开始响应」直接返回 524（正文是一张 HTML 错误页，表现为
 * `OpenAI API请求失败: 524 - <!DOCTYPE html>`）。长章节（推理模型 2–5 分钟）必然踩线。
 * 改成流式后首个数据块立刻返回，之后持续有字节流动就不会触发 100 秒判定；
 * CLI 直连服务商，不受此限制，所以只有前端需要。
 *
 * 各协议的事件格式不同，这里各给一个累加器，返回与原来非流式响应等价的
 * {content, finishReason, usage}。
 */

export interface StreamUsage {
  /** 输入 token */
  prompt?: number
  /** 输出 token */
  completion?: number
  /** 合计（缺省时由 prompt + completion 推出） */
  total?: number
}

export interface StreamResult {
  content: string
  finishReason?: string
  usage?: StreamUsage
  /** 上游完全不支持流式（部分网关），调用方应退回非流式请求 */
  unsupported?: boolean
}

/**
 * 上游真的在流式返回吗。
 * 部分网关忽略 `stream:true`、直接回一次性 JSON（也有的把 SSE 标成 application/json），
 * 这时必须按原样解析 JSON，而不是当成「流式无数据」判失败。
 */
export function isEventStream(response: Response): boolean {
  const type = (response.headers?.get?.('content-type') || '').toLowerCase()
  return type.includes('event-stream') || type.includes('ndjson')
}

/** 逐行读取响应体（SSE 用 \n 分帧，NDJSON 也是逐行） */
export async function readLines(
  body: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void
): Promise<void> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 只处理完整行，最后半行留在 buffer 里
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        onLine(buffer.slice(0, index).replace(/\r$/, ''))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) onLine(buffer.replace(/\r$/, ''))
  } finally {
    reader.releaseLock?.()
  }
}

/** 取 SSE 一行的 data 负载；非 data 行（event: / id: / 注释）返回 null */
function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).trim()
}

function safeJson<T = Record<string, unknown>>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function finish(total: StreamUsage | undefined): StreamUsage | undefined {
  if (!total) return undefined
  if (total.total === undefined && (total.prompt !== undefined || total.completion !== undefined)) {
    total.total = (total.prompt ?? 0) + (total.completion ?? 0)
  }
  return total
}

/** OpenAI 兼容 /chat/completions 的流（含 MiniMax、SenseNova、navira、opendesign 等） */
export async function parseOpenAIStream(response: Response): Promise<StreamResult> {
  let content = ''
  let finishReason: string | undefined
  let usage: StreamUsage | undefined
  let sawAnyData = false

  await readLines(response.body, (line) => {
    const data = sseData(line)
    if (!data) return
    if (data === '[DONE]') return
    const chunk = safeJson<{
      choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }>(data)
    if (!chunk) return
    sawAnyData = true
    const choice = chunk.choices?.[0]
    if (choice?.delta?.content) content += choice.delta.content
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (chunk.usage) {
      usage = {
        prompt: chunk.usage.prompt_tokens,
        completion: chunk.usage.completion_tokens,
        total: chunk.usage.total_tokens,
      }
    }
  })

  return { content, finishReason, usage: finish(usage), unsupported: !sawAnyData }
}

/** Anthropic Messages 的流（与前端 anthropicProvider 配套） */
export async function parseAnthropicStream(response: Response): Promise<StreamResult> {
  let content = ''
  let finishReason: string | undefined
  let usage: StreamUsage | undefined
  let sawAnyData = false

  await readLines(response.body, (line) => {
    const data = sseData(line)
    if (!data) return
    const event = safeJson<{
      type?: string
      delta?: { text?: string; stop_reason?: string | null }
      message?: { usage?: { input_tokens?: number; output_tokens?: number } }
      usage?: { input_tokens?: number; output_tokens?: number }
    }>(data)
    if (!event) return
    sawAnyData = true
    switch (event.type) {
      case 'content_block_delta':
        if (event.delta?.text) content += event.delta.text
        break
      case 'message_start':
        if (event.message?.usage) {
          usage = {
            prompt: event.message.usage.input_tokens,
            completion: event.message.usage.output_tokens,
          }
        }
        break
      case 'message_delta':
        if (event.delta?.stop_reason) finishReason = event.delta.stop_reason
        if (event.usage) {
          usage = {
            prompt: usage?.prompt ?? event.usage.input_tokens,
            completion: event.usage.output_tokens,
          }
        }
        break
      default:
        break
    }
  })

  return {
    content,
    // Anthropic 用 max_tokens 表示截断；与非流式一致地映射成 length
    finishReason: finishReason === 'max_tokens' ? 'length' : finishReason,
    usage: finish(usage),
    unsupported: !sawAnyData,
  }
}

/** Gemini :streamGenerateContent?alt=sse */
export async function parseGeminiStream(response: Response): Promise<StreamResult> {
  let content = ''
  let finishReason: string | undefined
  let usage: StreamUsage | undefined
  let sawAnyData = false

  await readLines(response.body, (line) => {
    const data = sseData(line)
    if (!data) return
    const chunk = safeJson<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    }>(data)
    if (!chunk) return
    sawAnyData = true
    const candidate = chunk.candidates?.[0]
    const text = candidate?.content?.parts?.map((part) => part?.text ?? '').join('') ?? ''
    content += text
    if (candidate?.finishReason) finishReason = candidate.finishReason
    if (chunk.usageMetadata) {
      usage = {
        prompt: chunk.usageMetadata.promptTokenCount,
        completion: chunk.usageMetadata.candidatesTokenCount,
        total: chunk.usageMetadata.totalTokenCount,
      }
    }
  })

  return { content, finishReason, usage: finish(usage), unsupported: !sawAnyData }
}

/** Ollama /api/chat 的 NDJSON 流 */
export async function parseOllamaStream(response: Response): Promise<StreamResult> {
  let content = ''
  let finishReason: string | undefined
  let usage: StreamUsage | undefined
  let sawAnyData = false

  await readLines(response.body, (line) => {
    if (!line.trim()) return
    const chunk = safeJson<{
      message?: { content?: string }
      done?: boolean
      done_reason?: string
      prompt_eval_count?: number
      eval_count?: number
    }>(line)
    if (!chunk) return
    sawAnyData = true
    if (chunk.message?.content) content += chunk.message.content
    if (chunk.done_reason) finishReason = chunk.done_reason
    else if (chunk.done) finishReason = 'stop'
    if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
      usage = { prompt: chunk.prompt_eval_count, completion: chunk.eval_count }
    }
  })

  return { content, finishReason, usage: finish(usage), unsupported: !sawAnyData }
}

/** 上游明确不支持流式（参数被拒）：调用方退回非流式 */
export function isStreamUnsupportedError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422 && status !== 404) return false
  return /stream/i.test(body ?? '') && /unsupported|not supported|unknown|unrecognized|invalid|does not support/i.test(body ?? '')
}
