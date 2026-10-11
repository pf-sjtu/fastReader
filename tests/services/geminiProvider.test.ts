import { describe, it, expect, vi, beforeEach } from 'vitest'

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => {
  const generateContentMock = vi.fn()
  const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }))
  return { generateContentMock, getGenerativeModelMock }
})

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModelMock
  },
}))

vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GeminiProvider } from '../../src/services/ai/geminiProvider'
import { resetProviderCooldowns } from '../../src/services/ai/retry'

function sdkResult(text: string, finishReason = 'STOP', totalTokenCount = 10) {
  return {
    response: {
      text: () => text,
      candidates: [{ finishReason }],
      usageMetadata: { totalTokenCount },
    },
  }
}

const config = { provider: 'gemini' as const, apiKey: 'g-key', model: 'gemini-2.0-flash' }

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetProviderCooldowns()
  })

  it('generationConfig 放在请求体、signal 通过 SingleRequestOptions 传给 SDK', async () => {
    generateContentMock.mockResolvedValue(sdkResult('答案'))
    const onTokenUsage = vi.fn()
    const ctrl = new AbortController()
    const provider = new GeminiProvider({ ...config, temperature: 0.3 }, { onTokenUsage, maxRetries: 1 })

    const res = await provider.generateContent({ prompt: '正文', systemPrompt: '请用中文回复。' }, { signal: ctrl.signal })

    expect(getGenerativeModelMock).toHaveBeenCalledWith({ model: 'gemini-2.0-flash' })
    const [request, requestOptions] = generateContentMock.mock.calls[0]
    expect(request.generationConfig).toEqual({ temperature: 0.3 })
    expect(request.contents[0].parts[0].text).toBe('正文\n\n**请用中文回复。**')
    expect(requestOptions.signal).toBe(ctrl.signal)
    expect(res).toMatchObject({ content: '答案', tokenCount: 10, finishReason: 'STOP' })
    expect(res.truncated).toBeUndefined()
    expect(onTokenUsage).toHaveBeenCalledWith(10)
  })

  it('MAX_TOKENS 标记截断', async () => {
    generateContentMock.mockResolvedValue(sdkResult('半截', 'MAX_TOKENS'))
    const res = await new GeminiProvider(config, { maxRetries: 1 }).generateContent({ prompt: 'p' })
    expect(res.truncated).toBe(true)
  })

  it('SDK 抛带 status 的 4xx 不重试', async () => {
    const err = Object.assign(new Error('[400] API key not valid'), { status: 400 })
    generateContentMock.mockRejectedValue(err)
    await expect(new GeminiProvider(config, { maxRetries: 3 }).generateContent({ prompt: 'p' })).rejects.toBe(err)
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('testConnection 成功与失败', async () => {
    generateContentMock.mockResolvedValueOnce(sdkResult('OK'))
    await expect(new GeminiProvider(config).testConnection()).resolves.toEqual({ success: true })

    generateContentMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }))
    await expect(new GeminiProvider(config).testConnection()).resolves.toEqual({ success: false, error: 'denied' })
  })
})
