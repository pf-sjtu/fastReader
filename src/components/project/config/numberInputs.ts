// 数字输入解析：空串/非法值回落到默认；0 是合法值，不能用 `|| 默认值` 兜底

/** 温度：非法值回落到 0.7 */
export function parseTemperature(raw: string): number {
  const v = parseFloat(raw)
  return Number.isFinite(v) ? v : 0.7
}

/** 非负整数：非法或负数回落到 fallback */
export function parseNonNegativeInt(raw: string, fallback: number): number {
  const v = parseInt(raw, 10)
  return Number.isFinite(v) && v >= 0 ? v : fallback
}
