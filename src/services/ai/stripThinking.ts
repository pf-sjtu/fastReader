/**
 * 剥掉推理模型混进正文的思考过程。
 *
 * 部分 OpenAI 兼容网关（如 MiniMax-M3）会把 `<think>…</think>` 直接写进 `message.content`，
 * 不剥掉的话它会进入章节摘要、导图 JSON 解析与缓存，污染每一本书。
 *
 * 只剥「开头」的思考块：正文中间出现 `<think>` 字样（例如书里在讨论这个标签）不动。
 * 未闭合的开头 `<think>`（输出被截断在思考阶段）视为整段都是思考，返回空串，让上层按「空内容」失败重试。
 */
const LEADING_THINK = /^\s*<(think|thinking|reasoning)>[\s\S]*?<\/\1>\s*/i
const UNCLOSED_THINK = /^\s*<(think|thinking|reasoning)>/i

export function stripThinking(content: string): string {
  if (!content) return content
  let out = content
  // 个别模型会连续输出多段思考
  for (let i = 0; i < 5 && LEADING_THINK.test(out); i++) {
    out = out.replace(LEADING_THINK, '')
  }
  if (UNCLOSED_THINK.test(out)) return ''
  return out
}
