import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('应用发生未捕获错误:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full rounded-lg border bg-card p-6 text-center space-y-3">
            <h1 className="text-lg font-semibold text-foreground">页面发生错误</h1>
            <p className="text-sm text-muted-foreground">请刷新页面后重试。</p>
            <Button type="button" onClick={this.handleReload}>
              刷新页面
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
