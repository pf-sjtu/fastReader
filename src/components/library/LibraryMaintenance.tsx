import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/ui/section-heading'
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
import { createLibraryIO } from '@/services/library/libraryIO'
import { clearLibraryMirror } from '@/services/library/libraryService'
import { emptyIndex } from '@/services/library/libraryIndex'
import { useLibraryStore } from '@/services/library/libraryStore'
import { ArtifactCleanup } from './ArtifactCleanup'

/** 设置页的书库维护：清空本地缓存（可随时再拉回）/ 重建索引（丢失已读进度，需确认） */
export function LibraryMaintenance() {
  const { t } = useTranslation()
  const rebuild = useLibraryStore((s) => s.rebuild)
  const refreshing = useLibraryStore((s) => s.refreshing)
  const [confirmRebuild, setConfirmRebuild] = useState(false)

  const clearLocal = async () => {
    const io = createLibraryIO()
    if (!io) return
    await clearLibraryMirror(io)
    useLibraryStore.setState({ index: emptyIndex(0), fresh: false })
    toast.success(t('library.maintenance.cleared'))
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <PanelHeader title={t('library.maintenance.title')} description={t('library.maintenance.hint')} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void clearLocal()}>
          {t('library.maintenance.clearLocal')}
        </Button>
        <ArtifactCleanup />
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => setConfirmRebuild(true)}>
          {t('library.maintenance.rebuild')}
        </Button>
      </div>

      <AlertDialog open={confirmRebuild} onOpenChange={setConfirmRebuild}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('library.maintenance.rebuildTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('library.maintenance.rebuildWarn')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void rebuild().then(() => toast.success(t('library.maintenance.rebuilt')))
              }}
            >
              {t('library.maintenance.rebuild')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
