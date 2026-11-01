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
import richRepairFormat from '../prompts/config/rich-repair.schema.json'
import studyKitFormat from '../prompts/config/study-kit.schema.json'
import quizFormat from '../prompts/config/quiz.schema.json'

/** 只要求「输出合法 JSON」而不给 schema：结构复杂 / 递归 / 字段大量可选的输出（关键图表、思维导图） */
export const JSON_MODE: StructuredFormat = { name: 'json' }

/** 速读包 / 自测题 / 坏块修复的 schema：与 CLI 共用 config/*.schema.json（自测里不适用的字段给 null，解析端按 nullish 处理） */
export const STUDY_KIT_FORMAT: StructuredFormat = studyKitFormat
export const QUIZ_FORMAT: StructuredFormat = quizFormat

/** 富内容块修复：只回传「块编号 + 修好的源码（或 null 放弃）」，不回传正文。schema 与 CLI 共用 config/rich-repair.schema.json */
export const RICH_REPAIR_FORMAT: StructuredFormat = richRepairFormat

/** 上游是否因为「不认识 / 不支持结构化输出参数」而拒绝（400/422 且正文提到相关字段） */
export function isStructuredFormatError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  return /response_format|json_schema|json_object|responseSchema|responseJsonSchema|responseMimeType|output_config|output_format|structured|schema|\bformat\b/i.test(body ?? '')
}
