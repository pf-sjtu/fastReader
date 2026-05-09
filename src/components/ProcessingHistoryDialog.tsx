import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BookOpen, Clock, Trash2, Loader2 } from 'lucide-react'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

interface ProcessingHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectRecord: (record: ProcessingHistoryRecord) => void
}

export function ProcessingHistoryDialog({
  open,
  onOpenChange,
  onSelectRecord
}: ProcessingHistoryDialogProps) {
  const { t, i18n } = useTranslation()
  const { records, clearHistory } = useProcessingHistoryStore()
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)

  const handleSelect = async (record: ProcessingHistoryRecord) => {
    setLoadingFileName(record.fileName)
    try {
      await onSelectRecord(record)
    } finally {
      setLoadingFileName(null)
    }
  }

  const handleClearHistory = () => {
    clearHistory()
  }

  const formatDate = (isoString: string) => {
    const date = new Date(isoString)
    const locale = i18n.language === 'zh' ? 'zh-CN' : 'en-US'
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'summary': return t('history.modeSummary')
      case 'mindmap': return t('history.modeMindmap')
      case 'combined-mindmap': return t('history.modeCombinedMindmap')
      default: return mode
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {t('history.dialogTitle')}
            </span>
            {records.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearHistory}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t('history.clearAll')}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          {records.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('history.empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((record) => (
                <button
                  key={`${record.fileName}-${record.completedAt}`}
                  className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors disabled:opacity-50"
                  onClick={() => handleSelect(record)}
                  disabled={loadingFileName !== null}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {loadingFileName === record.fileName && (
                          <Loader2 className="h-3.5 w-3.5 inline-block mr-1 animate-spin" />
                        )}
                        {record.bookTitle}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(record.completedAt)}</span>
                        <span>·</span>
                        <span>{getModeLabel(record.processingMode)}</span>
                        <span>·</span>
                        <span>{record.model}</span>
                        <span>·</span>
                        <span>{record.chapterCount} {t('history.chapters')}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
