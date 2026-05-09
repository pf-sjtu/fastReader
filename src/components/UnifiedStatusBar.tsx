import { memo, useState } from 'react'
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
  Zap,
  BookOpen,
  History,
  ExternalLink
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import { ProcessingHistoryDialog } from '@/components/ProcessingHistoryDialog'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

interface UnifiedStatusBarProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  progress?: number
  currentStep?: string
  currentModel?: string
  tokenUsage?: number
  onToggleView?: () => void
  onLoadFromHistory?: (record: ProcessingHistoryRecord) => Promise<boolean>
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
  onLoadFromHistory,
  className
}: UnifiedStatusBarProps) {
  const { t } = useTranslation()
  const { records } = useProcessingHistoryStore()
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)

  // 最近 2 条记录
  const recentRecords = records.slice(0, 2)
  const hasMore = records.length > 2

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

  const handleHistorySelect = async (record: ProcessingHistoryRecord) => {
    if (!onLoadFromHistory) return
    setLoadingFileName(record.fileName)
    try {
      const success = await onLoadFromHistory(record)
      if (success) {
        setHistoryDialogOpen(false)
      }
    } finally {
      setLoadingFileName(null)
    }
  }

  // 显示最近历史的条件：配置视图 + 无处理中 + 有历史记录 + 有回调
  const showRecentHistory =
    currentView === 'config' &&
    !processing &&
    progress === 0 &&
    recentRecords.length > 0 &&
    onLoadFromHistory

  return (
    <>
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

            {/* 中间：进度条 / 最近历史 / 状态信息 */}
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
              ) : showRecentHistory ? (
                <div className="flex items-center justify-center gap-3">
                  <History className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-2 text-sm">
                    {recentRecords.map((record) => (
                      <Button
                        key={record.fileName}
                        variant="ghost"
                        size="sm"
                        className="h-auto py-0.5 px-2 text-sm text-muted-foreground hover:text-foreground"
                        onClick={() => handleHistorySelect(record)}
                        disabled={loadingFileName !== null}
                      >
                        {loadingFileName === record.fileName ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3 w-3 mr-1" />
                        )}
                        <span className="truncate max-w-[120px]">{record.bookTitle}</span>
                      </Button>
                    ))}
                    {hasMore && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto py-0.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setHistoryDialogOpen(true)}
                      >
                        {t('history.viewMore')}
                      </Button>
                    )}
                  </div>
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

      <ProcessingHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        onSelectRecord={handleHistorySelect}
      />
    </>
  )
})
