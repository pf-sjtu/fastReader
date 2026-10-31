/** 稳定哈希：同一本书永远得到同一个色槽（1..10），和实体配色同一套 token，明暗主题自动适配 */
export function coverSlot(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return (Math.abs(h) % 10) + 1
}

/** 取第一个有意义的字符（跳过书名号/引号/空白），作为装饰首字 */
export function monogramOf(title: string): string {
  const m = (title ?? '').match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '书'
}
