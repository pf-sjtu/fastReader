import { bookChartsSchema, enforceChartLimits, type BookChartsParsed } from './schema'
import type { BookCharts } from './types'

/**
 * 从 AI 文本中提取 JSON 对象字符串（支持 ```json fence）
 */
export function extractJsonObject(text: string): string | null {
  const raw = (text || '').trim()
  if (!raw) return null

  // 优先 fence
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    const inner = fence[1].trim()
    if (inner.startsWith('{')) return inner
  }

  // 首个平衡大括号块
  const start = raw.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return raw.slice(start, i + 1)
      }
    }
  }
  return null
}

/**
 * 解析 AI 输出为 BookCharts；失败返回 null
 */
export function parseCharts(text: string): BookCharts | null {
  const jsonStr = extractJsonObject(text)
  if (!jsonStr) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return null
  }

  // 兼容模型漏 version / 包一层 data
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (obj.data && typeof obj.data === 'object') {
      parsed = { version: 1, ...(obj.data as object) }
    } else if (obj.version == null) {
      parsed = { version: 1, ...obj }
    }
  }

  const result = bookChartsSchema.safeParse(parsed)
  if (!result.success) {
    console.warn('[parseCharts] schema 校验失败:', result.error.issues?.slice(0, 5))
    return null
  }

  const limited = enforceChartLimits(result.data as BookChartsParsed)

  // 至少有一种图的数据才算成功
  const hasPerson = (limited.personGraph?.nodes.length ?? 0) > 0
  const hasTimeline =
    (limited.entityTimeline?.entities.length ?? 0) > 0 ||
    (limited.entityTimeline?.events.length ?? 0) > 0

  if (!hasPerson && !hasTimeline) return null

  return limited as BookCharts
}

/** 序列化进缓存 */
export function serializeCharts(charts: BookCharts): string {
  return JSON.stringify(charts)
}

/** 从缓存字符串恢复 */
export function deserializeCharts(raw: string | null | undefined): BookCharts | null {
  if (!raw || !raw.trim()) return null
  try {
    const obj = JSON.parse(raw)
    const result = bookChartsSchema.safeParse(
      obj?.version == null ? { version: 1, ...obj } : obj
    )
    if (!result.success) return null
    const limited = enforceChartLimits(result.data as BookChartsParsed)
    return limited as BookCharts
  } catch {
    return null
  }
}
