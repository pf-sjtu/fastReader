/**
 * 格式化（JSON）请求走上游结构化输出标准：四种协议的请求体 + 不认识时逐档降级 + 降级成功才记住。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resetLearnedParams, getLearnedParams, learnedParamsKey } from '../src/services/ai/outputBudget'
import { OpenAIProvider } from '../src/services/ai/openaiProvider'
import { AnthropicProvider } from '../src/services/ai/anthropicProvider'
import { GeminiProvider } from '../src/services/ai/geminiProvider'
import { OllamaProvider } from '../src/services/ai/ollamaProvider'
import { JSON_MODE, QUIZ_FORMAT, STUDY_KIT_FORMAT, RICH_REPAIR_FORMAT, isStructuredFormatError } from '../src/services/ai/structured'
import { parseQuiz, parseStudyKit } from '../src/study/schema'

afterEach(() => {
  vi.unstubAllGlobals()
  resetLearnedParams()
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const bad = (msg: string) => new Response(JSON.stringify({ error: { message: msg } }), { status: 400, headers: { 'content-type': 'application/json' } })
const bodyOf = (mock: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(mock.mock.calls[i][1].body))
const base = { apiUrl: 'https://x.test/v1', model: 'm', temperature: 0.3 }
const oai = (extra = {}) => new OpenAIProvider({ ...base, provider: 'openai', ...extra })
const OK_OAI = () => ok({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })

describe('schema 本身：strict 兼容（对象闭合、属性全 required）', () => {
  const walk = (n: unknown, path = ''): string[] => {
    if (!n || typeof n !== 'object') return []
    const o = n as Record<string, unknown>
    const errs: string[] = []
    if (o.type === 'object') {
      const props = Object.keys((o.properties as object) ?? {})
      if (o.additionalProperties !== false) errs.push(`${path}: additionalProperties 必须为 false`)
      if (JSON.stringify([...props].sort()) !== JSON.stringify([...((o.required as string[]) ?? [])].sort())) errs.push(`${path}: required 必须列全 properties`)
    }
    for (const [k, v] of Object.entries(o)) errs.push(...walk(v, `${path}/${k}`))
    return errs
  }
  for (const f of [STUDY_KIT_FORMAT, QUIZ_FORMAT, RICH_REPAIR_FORMAT]) it(f.name, () => expect(walk(f.schema)).toEqual([]))
  it('JSON_MODE 无 schema', () => expect(JSON_MODE.schema).toBeUndefined())
})

describe('解析端接受 strict schema 的输出（不适用字段为 null）', () => {
  it('自测：简答题 options/answerIndex 为 null、选择题 answer 为 null', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'choice', question: 'q1', options: ['a', 'b'], answerIndex: 1, answer: null, explanation: 'e', chapterTitle: '第1章' },
        { type: 'short', question: 'q2', options: null, answerIndex: null, answer: '答', explanation: '', chapterTitle: '' },
      ],
    })
    const q = parseQuiz(raw, [{ id: 'c1', title: '第1章' }])!
    expect(q.questions).toHaveLength(2)
    expect(q.questions[0]).toMatchObject({ type: 'choice', answerIndex: 1, options: ['a', 'b'], chapterId: 'c1' })
    expect(q.questions[1]).toMatchObject({ type: 'short', answer: '答' })
  })
  it('速读包：terms 为空数组也行', () => {
    const kit = parseStudyKit(JSON.stringify({ chapters: [{ chapterTitle: 'T', oneLiner: 'o', points: ['p'], terms: [] }] }), [{ id: 'c', title: 'T' }])
    expect(kit?.chapters[0].terms).toEqual([])
  })
})

describe('OpenAI 兼容：response_format', () => {
  it('有 schema → json_schema + strict', async () => {
    const f = vi.fn(async () => OK_OAI())
    vi.stubGlobal('fetch', f)
    await oai().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(bodyOf(f).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'quiz', strict: true, schema: QUIZ_FORMAT.schema } })
  })
  it('无 schema（JSON_MODE）→ json_object；不带 format → 不发', async () => {
    const f = vi.fn(async () => OK_OAI())
    vi.stubGlobal('fetch', f)
    await oai().generateContent({ prompt: 'p', format: JSON_MODE })
    expect(bodyOf(f).response_format).toEqual({ type: 'json_object' })
    await oai().generateContent({ prompt: 'p' })
    expect(bodyOf(f, 1)).not.toHaveProperty('response_format')
  })
  it('不认 json_schema → 退 json_object 重试；成功后记住 noJsonSchema，下次直接用 json_object', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad("Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model."))
      .mockImplementation(async () => OK_OAI())
    vi.stubGlobal('fetch', f)
    await oai().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(f).toHaveBeenCalledTimes(2)
    expect(bodyOf(f, 1).response_format).toEqual({ type: 'json_object' })
    expect(getLearnedParams(learnedParamsKey(undefined, base.apiUrl, 'm')).noJsonSchema).toBe(true)
    await oai().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(bodyOf(f, 2).response_format).toEqual({ type: 'json_object' }) // 不再先试 schema
  })
  it('json_object 也不认 → 不带格式参数；记住 noStructured', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad('response_format json_schema unsupported'))
      .mockResolvedValueOnce(bad('response_format json_object unsupported'))
      .mockImplementation(async () => OK_OAI())
    vi.stubGlobal('fetch', f)
    await oai().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(f).toHaveBeenCalledTimes(3)
    expect(bodyOf(f, 2)).not.toHaveProperty('response_format')
    expect(getLearnedParams(learnedParamsKey(undefined, base.apiUrl, 'm')).noStructured).toBe(true)
  })
  it('降级后仍失败：不记住（失败的试探值不存档）', async () => {
    const f = vi.fn(async () => bad('response_format not supported, also model overloaded'))
    vi.stubGlobal('fetch', f)
    await expect(oai({ model: 'm2' }).generateContent({ prompt: 'p', format: QUIZ_FORMAT })).rejects.toBeTruthy()
    const l = getLearnedParams(learnedParamsKey(undefined, base.apiUrl, 'm2'))
    expect(l.noJsonSchema).toBeUndefined()
    expect(l.noStructured).toBeUndefined()
  })
  it('与「不支持思考」互不误判：response_format 报错不会关掉思考参数', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad('Unsupported parameter: response_format.json_schema'))
      .mockImplementation(async () => OK_OAI())
    vi.stubGlobal('fetch', f)
    await oai({ reasoningEffort: 'high', supportsReasoning: true }).generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(bodyOf(f, 1).response_format).toEqual({ type: 'json_object' })
  })
})

describe('Anthropic：output_config.format', () => {
  const anth = () => new AnthropicProvider({ ...base, provider: 'anthropic', apiUrl: 'https://a.test/v1' })
  const okA = () => ok({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
  it('有 schema → output_config.format(json_schema)；无 schema（JSON_MODE）→ 不发（Anthropic 无纯 JSON 模式）', async () => {
    const f = vi.fn(async () => okA())
    vi.stubGlobal('fetch', f)
    await anth().generateContent({ prompt: 'p', format: STUDY_KIT_FORMAT })
    expect(bodyOf(f).output_config).toEqual({ format: { type: 'json_schema', schema: STUDY_KIT_FORMAT.schema } })
    await anth().generateContent({ prompt: 'p', format: JSON_MODE })
    expect(bodyOf(f, 1)).not.toHaveProperty('output_config')
    expect(bodyOf(f)).not.toHaveProperty('output_format') // 旧参数已弃用
  })
  it('不支持 → 去掉重试，成功后记住 noStructured', async () => {
    const f = vi.fn().mockResolvedValueOnce(bad('output_config.format: Extra inputs are not permitted')).mockImplementation(async () => okA())
    vi.stubGlobal('fetch', f)
    await anth().generateContent({ prompt: 'p', format: STUDY_KIT_FORMAT })
    expect(bodyOf(f, 1)).not.toHaveProperty('output_config')
    expect(getLearnedParams(learnedParamsKey(undefined, 'https://a.test/v1', 'm')).noStructured).toBe(true)
  })
})

describe('Gemini：responseMimeType + responseJsonSchema', () => {
  const gem = () => new GeminiProvider({ ...base, provider: 'gemini', apiUrl: 'https://g.test/v1beta' })
  const okG = () => ok({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] })
  it('有 schema → 两个字段都发；JSON_MODE → 只发 MIME', async () => {
    const f = vi.fn(async () => okG())
    vi.stubGlobal('fetch', f)
    await gem().generateContent({ prompt: 'p', format: RICH_REPAIR_FORMAT })
    const cfg = bodyOf(f).generationConfig
    expect(cfg.responseMimeType).toBe('application/json')
    expect(cfg.responseJsonSchema).toEqual(RICH_REPAIR_FORMAT.schema)
    await gem().generateContent({ prompt: 'p', format: JSON_MODE })
    expect(bodyOf(f, 1).generationConfig).toMatchObject({ responseMimeType: 'application/json' })
    expect(bodyOf(f, 1).generationConfig).not.toHaveProperty('responseJsonSchema')
  })
  it('不认 schema → 仅 MIME 重试；再不认 → 都不带', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad('Unknown name "responseJsonSchema": Cannot find field.'))
      .mockResolvedValueOnce(bad('responseMimeType is not supported for this model'))
      .mockImplementation(async () => okG())
    vi.stubGlobal('fetch', f)
    await gem().generateContent({ prompt: 'p', format: RICH_REPAIR_FORMAT })
    expect(bodyOf(f, 1).generationConfig).not.toHaveProperty('responseJsonSchema')
    expect(bodyOf(f, 1).generationConfig.responseMimeType).toBe('application/json')
    expect(bodyOf(f, 2).generationConfig).not.toHaveProperty('responseMimeType')
  })
})

describe('Ollama：format', () => {
  const oll = () => new OllamaProvider({ ...base, provider: 'ollama', apiUrl: 'http://localhost:11434' })
  const okO = () => ok({ message: { content: '{}' }, done: true, done_reason: 'stop' })
  it('有 schema → format 为 JSON Schema；JSON_MODE → "json"', async () => {
    const f = vi.fn(async () => okO())
    vi.stubGlobal('fetch', f)
    await oll().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(bodyOf(f).format).toEqual(QUIZ_FORMAT.schema)
    await oll().generateContent({ prompt: 'p', format: JSON_MODE })
    expect(bodyOf(f, 1).format).toBe('json')
  })
  it('老版本不认 schema → 退 "json" 重试', async () => {
    const f = vi.fn().mockResolvedValueOnce(bad('invalid format: expected "json" or a JSON schema')).mockImplementation(async () => okO())
    vi.stubGlobal('fetch', f)
    await oll().generateContent({ prompt: 'p', format: QUIZ_FORMAT })
    expect(bodyOf(f, 1).format).toBe('json')
  })
})

describe('isStructuredFormatError', () => {
  it('只认 400/422 且提到格式相关字段', () => {
    expect(isStructuredFormatError(400, 'response_format is invalid')).toBe(true)
    expect(isStructuredFormatError(422, 'output_config.format unsupported')).toBe(true)
    expect(isStructuredFormatError(500, 'response_format')).toBe(false)
    expect(isStructuredFormatError(400, 'invalid api key')).toBe(false)
    expect(isStructuredFormatError(undefined, '')).toBe(false)
  })
})
