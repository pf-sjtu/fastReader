import { AlertCircle, LucideIcon } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  /** 自定义图标 */
  icon?: LucideIcon
  /** 错误标题 */
  title?: string
  /** 错误描述 */
  description?: string
  /** 重试按钮文本 */
  retryLabel?: string
  /** 重试回调 */
  onRetry?: () => void
  /** 自定义类名 */
  className?: string
}

export function ErrorState({
  icon: Icon = AlertCircle,
  title = '出错了',
  description = '操作过程中发生了错误，请稍后重试',
  retryLabel = '重试',
  onRetry,
  className
}: ErrorStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-8 text-center",
      className
    )}>
      <div className="mb-4 p-4 rounded-full bg-destructive/10">
        <Icon className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          {description}
        </p>
      )}
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
