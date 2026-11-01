import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow } from '@/components/ui/list-row'
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
  const { records, clearLocalView } = useProcessingHistoryStore(
    useShallow((s) => ({
      records: s.records,
      clearLocalView: s.clearLocalView,
    }))
  )
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const handleSelect = async (record: ProcessingHistoryRecord) => {
    setLoadingFileName(record.fileName)
    try {
      await onSelectRecord(record)
    } finally {
      setLoadingFileName(null)
    }
  }

  // 只清空本浏览器的视图；共享历史在服务端，不受影响
  const handleConfirmClear = () => {
    clearLocalView()
    setConfirmClearOpen(false)
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
                onClick={() => setConfirmClearOpen(true)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />
                {t('history.clearLocalView')}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          {records.length === 0 ? (
            <EmptyState icon={BookOpen} title={t('history.empty')} className="py-8" />
          ) : (
            <div className="space-y-2">
              {records.map((record) => (
                <ListRow
                  key={`${record.fileName}-${record.completedAt}`}
                  className="rounded-lg border p-3"
                  onClick={() => handleSelect(record)}
                  disabled={loadingFileName !== null}
                  title={
                    <>
                      {loadingFileName === record.fileName && (
                        <Loader2 className="mr-1 inline-block h-3.5 w-3.5 animate-spin" />
                      )}
                      {record.bookTitle}
                    </>
                  }
                  description={[
                    formatDate(record.completedAt),
                    getModeLabel(record.processingMode),
                    record.model,
                    `${record.chapterCount} ${t('history.chapters')}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.confirmClearLocalTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.confirmClearLocalDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClear}>{t('history.clearLocalView')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
