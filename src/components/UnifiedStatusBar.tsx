import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { 
  Settings, 
  Brain, 
  ArrowLeft, 
  ArrowRight, 
  Loader2,
  Bot,
  Zap
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface UnifiedStatusBarProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  progress?: number
  currentStep?: string
  currentModel?: string
  tokenUsage?: number
  onToggleView?: () => void
  className?: string
}

export const UnifiedStatusBar = memo(function UnifiedStatusBar({
  currentView,
  processing = false,
  progress = 0,
  currentStep = '',
  currentModel = '',
  tokenUsage = 0,
  onToggleView,
  className
}: UnifiedStatusBarProps) {
  const { t } = useTranslation()

  const formatTokenCount = (tokens: number) => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  const getModelIcon = (model: string) => {
    if (model.toLowerCase().includes('gemini')) {
      return <Bot className="h-3 w-3" />
    } else if (model.toLowerCase().includes('gpt')) {
      return <Zap className="h-3 w-3" />
    }
    return <Brain className="h-3 w-3" />
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          {/* 左侧：切换按钮 */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleView}
              className="flex items-center gap-2"
            >
              {currentView === 'config' ? (
                <>
                  <Brain className="h-4 w-4" />
                  {t('statusBar.enterProcessing')}
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  <ArrowLeft className="h-4 w-4" />
                  {t('statusBar.backToConfig')}
                  <Settings className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>

          {/* 中间：进度条和状态信息 */}
          <div className="flex-1 mx-6">
            {processing || progress > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {processing ? currentStep : t('statusBar.completed')}
                  </span>
                  <span className="text-muted-foreground">
                    {Math.round(progress)}%
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            ) : currentView === 'config' ? (
              <div className="text-center text-sm text-muted-foreground">
                {t('statusBar.readyToProcess')}
              </div>
            ) : (
              <div className="text-center text-sm text-muted-foreground">
                {t('statusBar.viewingResults')}
              </div>
            )}
          </div>

          {/* 右侧：模型和token信息 */}
          <div className="flex items-center gap-3">
            {currentModel && (
              <Badge variant="secondary" className="flex items-center gap-1">
                {getModelIcon(currentModel)}
                <span className="text-xs">{currentModel}</span>
                {tokenUsage > 0 && (
                  <span className="text-xs text-muted-foreground">({formatTokenCount(tokenUsage)})</span>
                )}
              </Badge>
            )}

            {processing && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
