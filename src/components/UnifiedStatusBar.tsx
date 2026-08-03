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

  // 窄屏只展示最近 1 条历史，避免挤爆
  const mobileRecentRecords = recentRecords.slice(0, 1)

  return (
    <>
      <Card className={cn("w-full min-w-0", className)}>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* 切换按钮 + 模型信息（移动端同一行） */}
            <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-3 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleView}
                className="flex items-center gap-1.5 min-h-9"
              >
                {currentView === 'config' ? (
                  <>
                    <Brain className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t('statusBar.enterProcessing')}</span>
                    <span className="sm:hidden">{t('statusBar.enterProcessingShort')}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </>
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t('statusBar.backToConfig')}</span>
                    <span className="sm:hidden">{t('statusBar.backToConfigShort')}</span>
                    <Settings className="h-4 w-4 shrink-0" />
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 sm:hidden">
                {currentModel && (
                  <Badge variant="secondary" className="flex items-center gap-1 max-w-[10rem]">
                    {getModelIcon(currentModel)}
                    <span className="text-xs truncate">{currentModel}</span>
                    {tokenUsage > 0 && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        ({formatTokenCount(tokenUsage)})
                      </span>
                    )}
                  </Badge>
                )}
                {processing && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            {/* 中间：进度条 / 最近历史 / 状态信息 */}
            <div className="flex-1 min-w-0 mx-0 sm:mx-6">
              {processing || progress > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground truncate min-w-0">
                      {processing ? currentStep : t('statusBar.completed')}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              ) : showRecentHistory ? (
                <div className="flex items-center gap-2 sm:justify-center overflow-x-auto">
                  <History className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-1.5 text-sm min-w-0">
                    {/* 桌面显示 2 条，移动显示 1 条 */}
                    <div className="hidden sm:flex items-center gap-2">
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
                    </div>
                    <div className="flex sm:hidden items-center gap-1.5 min-w-0">
                      {mobileRecentRecords.map((record) => (
                        <Button
                          key={record.fileName}
                          variant="ghost"
                          size="sm"
                          className="h-auto py-0.5 px-2 text-sm text-muted-foreground hover:text-foreground min-w-0"
                          onClick={() => handleHistorySelect(record)}
                          disabled={loadingFileName !== null}
                        >
                          {loadingFileName === record.fileName ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin shrink-0" />
                          ) : (
                            <ExternalLink className="h-3 w-3 mr-1 shrink-0" />
                          )}
                          <span className="truncate max-w-[8rem]">{record.bookTitle}</span>
                        </Button>
                      ))}
                    </div>
                    {hasMore && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto py-0.5 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
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

            {/* 右侧：模型和token信息（桌面） */}
            <div className="hidden sm:flex items-center gap-3 shrink-0">
              {currentModel && (
                <Badge variant="secondary" className="flex items-center gap-1 max-w-[14rem]">
                  {getModelIcon(currentModel)}
                  <span className="text-xs truncate">{currentModel}</span>
                  {tokenUsage > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      ({formatTokenCount(tokenUsage)})
                    </span>
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
