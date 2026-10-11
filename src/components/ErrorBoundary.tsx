import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * 局部边界的区域名（如「结果区」）。设置后以内联卡片展示错误并提供「重试」，
   * 不设置则为整页兜底（main.tsx）。
   */
  section?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
  isChunkError: boolean
}

/**
 * lazy chunk 加载失败：新部署后旧 hash 的 chunk 已 404，只有刷新页面才能拿到新入口。
 * Vite 报 "Failed to fetch dynamically imported module"；webpack 系为 ChunkLoadError；
 * Safari 为 "Importing a module script failed"。
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError') return true
  const msg = typeof message === 'string' ? message : ''
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  )
}

const INITIAL_STATE: ErrorBoundaryState = { hasError: false, message: '', isChunkError: false }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error)
    return {
      hasError: true,
      message: message.trim() || '未知错误',
      isChunkError: isChunkLoadError(error),
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const where = this.props.section ? `「${this.props.section}」` : '应用'
    console.error(`${where}发生未捕获错误:`, error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  reset = () => {
    this.setState(INITIAL_STATE)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { message, isChunkError } = this.state

    const hint = isChunkError
      ? '应用已更新，当前页面引用的资源已失效，请刷新页面加载最新版本。'
      : '请刷新页面后重试。'

    if (this.props.section) {
      return (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 space-y-2 text-sm">
          <p className="font-medium text-foreground">{this.props.section}加载出错</p>
          <p className="text-muted-foreground">{isChunkError ? hint : '可重试该区域，或刷新页面。'}</p>
          {!isChunkError && (
            <p className="text-xs font-mono break-all rounded-md bg-muted p-2 text-foreground">{message}</p>
          )}
          <div className="flex gap-2">
            {!isChunkError && (
              <Button type="button" size="sm" variant="outline" onClick={this.reset}>
                重试
              </Button>
            )}
            <Button type="button" size="sm" onClick={this.handleReload}>
              刷新页面
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-lg border bg-card p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold text-foreground">页面发生错误</h1>
          <p className="text-sm text-muted-foreground">{hint}</p>
          <p className="text-xs font-mono text-left break-all rounded-md bg-muted p-3 text-foreground">
            {message}
          </p>
          <Button type="button" onClick={this.handleReload}>
            刷新页面
          </Button>
        </div>
      </div>
    )
  }
}
