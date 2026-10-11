import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import i18n from '../i18n'

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
      message: message.trim() || i18n.t('common.unknownError'),
      isChunkError: isChunkLoadError(error),
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.section ?? 'app'} 发生未捕获错误:`, error, errorInfo)
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

    // 类组件不能用 useTranslation；渲染时读取 i18n.t，语言切换会随父组件重渲染生效
    const hint = isChunkError ? i18n.t('errorBoundary.chunkHint') : i18n.t('errorBoundary.reloadHint')
    const reloadLabel = i18n.t('errorBoundary.reload')

    if (this.props.section) {
      return (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 space-y-2 text-sm">
          <p className="font-medium text-foreground">{i18n.t('errorBoundary.sectionFailed', { section: this.props.section })}</p>
          <p className="text-muted-foreground">{isChunkError ? hint : i18n.t('errorBoundary.sectionHint')}</p>
          {!isChunkError && (
            <p className="text-xs font-mono break-all rounded-md bg-muted p-2 text-foreground">{message}</p>
          )}
          <div className="flex gap-2">
            {!isChunkError && (
              <Button type="button" size="sm" variant="outline" onClick={this.reset}>
                {i18n.t('errorBoundary.retry')}
              </Button>
            )}
            <Button type="button" size="sm" onClick={this.handleReload}>
              {reloadLabel}
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-lg border bg-card p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold text-foreground">{i18n.t('errorBoundary.pageFailed')}</h1>
          <p className="text-sm text-muted-foreground">{hint}</p>
          <p className="text-xs font-mono text-left break-all rounded-md bg-muted p-3 text-foreground">
            {message}
          </p>
          <Button type="button" onClick={this.handleReload}>
            {reloadLabel}
          </Button>
        </div>
      </div>
    )
  }
}
