/**
 * 异步任务代际守卫：换书 / 重开 / 取消时递增代数，旧任务的回调据此丢弃结果，
 * 避免旧一轮完成后覆盖新状态（含 token 计数、云同步等副作用）。
 */

export interface GenerationCounter {
  /** 当前代数 */
  readonly current: number
  /** 作废所有旧任务，返回新代数 */
  bump(): number
  /** 给定代数是否仍是当前代 */
  isCurrent(generation: number): boolean
}

export function createGenerationCounter(): GenerationCounter {
  let current = 0
  return {
    get current() {
      return current
    },
    bump() {
      current += 1
      return current
    },
    isCurrent(generation: number) {
      return generation === current
    },
  }
}

export function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * 等待 promise 结束（成功或失败均可），最多等 timeoutMs。
 * 返回 true 表示已结束，false 表示超时（调用方据此决定是否继续，旧任务由代际守卫兜底）。
 */
export async function waitForSettled(
  promise: Promise<unknown> | null | undefined,
  timeoutMs: number
): Promise<boolean> {
  if (!promise) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const settled = promise.then(
    () => true as const,
    () => true as const
  )
  try {
    return await Promise.race([settled, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
