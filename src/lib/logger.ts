/**
 * 轻量日志：生产环境默认关闭 debug/info，保留 warn/error。
 * 开发或 VITE_DEBUG=1 时输出完整日志。
 */

const isDebugEnabled = (): boolean => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env.DEV) return true
      if (import.meta.env.VITE_DEBUG === '1' || import.meta.env.VITE_DEBUG === 'true') {
        return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

type LogArgs = unknown[]

export const logger = {
  debug(...args: LogArgs): void {
    if (isDebugEnabled()) console.log(...args)
  },
  info(...args: LogArgs): void {
    if (isDebugEnabled()) console.info(...args)
  },
  warn(...args: LogArgs): void {
    console.warn(...args)
  },
  error(...args: LogArgs): void {
    console.error(...args)
  },
}
