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
 * 并发限制器
 */
export class ConcurrencyLimiter {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private maxConcurrency: number) {}

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

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
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
export function throttle<T extends (...args: any[]) => any>(
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
