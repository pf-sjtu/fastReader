import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'

/**
 * 点开一本书时，WebDAV 连接正常、扫描成功，却确实没有这本书：问用户要不要删云端 metadata。
 * 只删云端书目里的封面与资料，不碰 WebDAV 上的任何文件。
 */
export function MissingBookDialog() {
  const { t } = useTranslation()
  const missing = useLibraryStore((s) => s.missing)
  const askRemove = useLibraryStore((s) => s.askRemove)
  const removeBooks = useLibraryStore((s) => s.removeBooks)
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={!!missing} onOpenChange={(o) => !o && !busy && askRemove(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('library.missing.title', { title: missing?.title ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('library.missing.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('library.missing.keep')}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || !missing}
            onClick={async () => {
              if (!missing) return
              setBusy(true)
              try {
                const n = await removeBooks([missing])
                if (n) toast.success(t('library.orphans.done', { count: n }))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('library.missing.remove')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const LIST_PREVIEW = 8

/**
 * 云端书目里有、WebDAV 上没有的书（一次成功扫描之后才可信）。只提示，由用户决定是否清理。
 */
export function OrphanNotice({ orphans }: { orphans: readonly LibraryEntry[] }) {
  const { t } = useTranslation()
  const removeBooks = useLibraryStore((s) => s.removeBooks)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (orphans.length === 0) return null
  return (
    <>
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <span className="mr-auto">{t('library.orphans.notice', { count: orphans.length })}</span>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setOpen(true)}>
          <Trash2 className="size-3.5" />
          {t('library.orphans.review')}
        </Button>
      </div>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('library.orphans.title', { count: orphans.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t('library.orphans.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
            {orphans.slice(0, LIST_PREVIEW).map((e) => (
              <li key={e.path} className="truncate">
                {e.title}
              </li>
            ))}
            {orphans.length > LIST_PREVIEW && <li className="text-muted-foreground">{t('library.orphans.more', { count: orphans.length - LIST_PREVIEW })}</li>}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('library.missing.keep')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const n = await removeBooks(orphans)
                  toast.success(t('library.orphans.done', { count: n }))
                  setOpen(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('library.orphans.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
