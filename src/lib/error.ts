/**
 * 统一的错误处理工具
 */

export interface AppError {
  success: false
  message: string
  code?: string
  details?: unknown
}

export interface AppSuccess<T> {
  success: true
  data: T
  message?: string
}

export type AppResult<T> = AppSuccess<T> | AppError

/**
 * 创建成功结果
 */
export function createSuccess<T>(data: T, message?: string): AppSuccess<T> {
  return {
    success: true,
    data,
    message
  }
}

/**
 * 创建错误结果
 */
export function createError(message: string, code?: string, details?: unknown): AppError {
  return {
    success: false,
    message,
    code,
    details
  }
}

/**
 * 判断是否为错误结果
 */
export function isError<T>(result: AppResult<T>): result is AppError {
  return !result.success
}

/**
 * 判断是否为成功结果
 */
export function isSuccess<T>(result: AppResult<T>): result is AppSuccess<T> {
  return result.success
}

/**
 * 安全地执行异步操作
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  errorMessage: string
): Promise<AppResult<T>> {
  try {
    const data = await fn()
    return createSuccess(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : errorMessage
    return createError(message, 'EXECUTION_ERROR', error)
  }
}
