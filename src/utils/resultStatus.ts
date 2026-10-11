// 处理结果的状态标记：前端单书、批量引擎、后处理过滤、云端同步共用同一套判断，
// 避免各处散落字符串字面量导致漏判（如失败章节被当成功结果同步到云端）

export const RESULT_PREFIX = {
  chapterFailed: '【处理失败】',
  chapterSkipped: '【已跳过】',
  connectionsFailed: '【关联分析失败】',
  overallFailed: '【全书总结失败】',
} as const

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '未知错误')
}

export function failedText(prefix: string, err: unknown): string {
  return `${prefix}${errorMessage(err)}`
}

/** 文本是否为任一失败/跳过占位（不应进入后处理 prompt、不应作为有效缓存） */
export function isPlaceholderText(text: string | undefined | null): boolean {
  if (!text) return false
  return Object.values(RESULT_PREFIX).some((p) => text.startsWith(p))
}

/** 文本是否为失败占位（跳过不算失败） */
export function isFailedText(text: string | undefined | null): boolean {
  if (!text) return false
  return (
    text.startsWith(RESULT_PREFIX.chapterFailed) ||
    text.startsWith(RESULT_PREFIX.connectionsFailed) ||
    text.startsWith(RESULT_PREFIX.overallFailed)
  )
}

/** 有可用内容：非空且不是占位 */
export function isUsableText(text: string | undefined | null): text is string {
  return !!text && text.trim().length > 0 && !isPlaceholderText(text)
}
