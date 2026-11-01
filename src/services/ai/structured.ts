/**
 * 格式化（JSON）请求一律走上游的结构化输出标准，而不是只在提示词里要求「只输出 JSON」：
 *   OpenAI 兼容  response_format: { type: 'json_schema', json_schema: { strict: true } }（退一档 json_object）
 *   Anthropic    output_config.format: { type: 'json_schema' }（GA；旧的 output_format 已弃用）
 *   Gemini       generationConfig.responseMimeType + responseJsonSchema
 *   Ollama       format: <JSON Schema>（退一档 'json'）
 * 上游保证输出能解析、字段齐全；解析端（zod）仍然保留作兜底，因为网关 / 老模型可能不认。
 * 不认识的网关会 400：provider 逐档降级重试（schema → json → 不带），降级后成功的经验才会被记住（learned）。
 *
 * strict 模式的 schema 约束：每个对象 additionalProperties:false、所有属性都在 required 里（可选的写成 ['x','null']）。
 */
import type { StructuredFormat } from '@/types/ai'

/** 只要求「输出合法 JSON」而不给 schema：结构复杂 / 递归 / 字段大量可选的输出（关键图表、思维导图） */
export const JSON_MODE: StructuredFormat = { name: 'json' }

const str = { type: 'string' } as const
const nullable = (type: 'string' | 'integer') => ({ type: [type, 'null'] }) as const

/** 速读包：与 study/schema.ts 的 rawKitChapter 对应 */
export const STUDY_KIT_FORMAT: StructuredFormat = {
  name: 'study_kit',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['chapters'],
    properties: {
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chapterTitle', 'oneLiner', 'points', 'terms'],
          properties: {
            chapterTitle: str,
            oneLiner: str,
            points: { type: 'array', items: str },
            terms: {
              type: 'array',
              items: { type: 'object', additionalProperties: false, required: ['term', 'definition'], properties: { term: str, definition: str } },
            },
          },
        },
      },
    },
  },
}

/** 自测题：选择题 / 简答题共用一个对象，不适用的字段给 null（解析端按 nullish 处理） */
export const QUIZ_FORMAT: StructuredFormat = {
  name: 'quiz',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'question', 'options', 'answerIndex', 'answer', 'explanation', 'chapterTitle'],
          properties: {
            type: { type: 'string', enum: ['choice', 'short'] },
            question: str,
            options: { type: ['array', 'null'], items: str },
            answerIndex: nullable('integer'),
            answer: nullable('string'),
            explanation: str,
            chapterTitle: str,
          },
        },
      },
    },
  },
}

/** 富内容块修复：只回传「块编号 + 修好的源码（或 null 放弃）」，不回传正文 */
export const RICH_REPAIR_FORMAT: StructuredFormat = {
  name: 'rich_block_fixes',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['fixes'],
    properties: {
      fixes: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['id', 'code'], properties: { id: { type: 'integer' }, code: nullable('string') } },
      },
    },
  },
}

/** 上游是否因为「不认识 / 不支持结构化输出参数」而拒绝（400/422 且正文提到相关字段） */
export function isStructuredFormatError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  return /response_format|json_schema|json_object|responseSchema|responseJsonSchema|responseMimeType|output_config|output_format|structured|schema|\bformat\b/i.test(body ?? '')
}
