/**
 * 异步工具函数
 */

/**
 * 等待指定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 重试配置选项
 */
export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
  onRetry?: (attempt: number, error: Error) => void
  shouldRetry?: (error: Error) => boolean
}

/**
 * 计算重试延迟（指数退避）
 */
export function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number = 300000
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
  // 添加随机抖动，避免惊群效应
  return delay + Math.random() * 1000
}

/**
 * 带重试的函数包装器
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 60000,
    maxDelay = 300000,
    onRetry,
    shouldRetry = () => true
  } = options

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt >= maxRetries || !shouldRetry(lastError)) {
        throw lastError
      }

      const delay = calculateRetryDelay(attempt, baseDelay, maxDelay)

      if (onRetry) {
        onRetry(attempt, lastError)
      }

      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * 规范化并发上限：默认 3，范围 [1, maxCap]
 */
export function clampConcurrency(
  value: unknown,
  defaultValue = 3,
  maxCap = 10
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return defaultValue
  return Math.min(maxCap, Math.max(1, Math.floor(n)))
}

/**
 * 并发限制器
 */
export class ConcurrencyLimiter {
  private running = 0
  private queue: Array<() => void> = []
  private maxConcurrency: number

  constructor(maxConcurrency: number) {
    this.maxConcurrency = clampConcurrency(maxConcurrency, 1, 100)
  }

  /**
   * 在并发限制下执行函数
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 等待直到有可用槽位
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve)
      })
    }

    this.running++

    try {
      return await fn()
    } finally {
      this.running--
      // 释放下一个等待的任务
      const next = this.queue.shift()
      if (next) {
        next()
      }
    }
  }

  /**
   * 批量执行，带并发控制
   */
  async executeBatch<T>(items: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(items.map(item => this.execute(item)))
  }
}

export interface MapPoolOrderedOptions<T> {
  /** 最大并发，默认 3 */
  concurrency?: number
  /**
   * 按索引顺序提交结果（完成乱序不影响呈现顺序）。
   * 仅当 index 之前的项均已完成时才会连续触发。
   */
  onOrderedResult?: (result: T, index: number) => void
  /** 任意一项完成时（可能乱序） */
  onItemSettled?: (result: T, index: number) => void
  /** 触发后不再出队新任务，并以 AbortError reject */
  signal?: AbortSignal
}

/**
 * 有限并发 map：任务可并行执行，结果数组与 onOrderedResult 严格按输入索引顺序。
 * 呈现顺序不受完成先后影响。
 *
 * 失败语义（C2）：任一任务 reject 或 signal 触发后立即 reject（首个错误 / AbortError），
 * 不再出队新任务；已开始的任务自然结束，但其结果不再触发回调。
 */
export function mapPoolOrdered<TItem, TResult>(
  items: readonly TItem[],
  mapper: (item: TItem, index: number) => Promise<TResult>,
  options: MapPoolOrderedOptions<TResult> = {}
): Promise<TResult[]> {
  const n = items.length
  const { signal } = options
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  if (n === 0) return Promise.resolve([])

  const concurrency = Math.min(clampConcurrency(options.concurrency ?? 3), n)
  const slots: TResult[] = new Array(n)
  const completed = new Array<boolean>(n).fill(false)
  let nextToCommit = 0
  let nextToStart = 0
  let finished = false

  return new Promise<TResult[]>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => fail(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', onAbort, { once: true })

    const commitReady = () => {
      while (nextToCommit < n && completed[nextToCommit]) {
        options.onOrderedResult?.(slots[nextToCommit], nextToCommit)
        nextToCommit++
      }
    }

    const worker = async (): Promise<void> => {
      while (!finished && nextToStart < n) {
        const index = nextToStart++
        const result = await mapper(items[index], index)
        if (finished) return
        slots[index] = result
        completed[index] = true
        options.onItemSettled?.(result, index)
        // 同步推进有序提交（JS 单线程，无需锁）
        commitReady()
      }
    }

    let active = concurrency
    for (let w = 0; w < concurrency; w++) {
      worker().then(
        () => {
          active--
          if (active === 0 && !finished) {
            finished = true
            signal?.removeEventListener('abort', onAbort)
            resolve(slots)
          }
        },
        fail
      )
    }
  })
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}
