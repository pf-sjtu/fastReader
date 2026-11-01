import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, Loader2, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SectionHeading } from '@/components/ui/section-heading'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { createLibraryIO } from '@/services/library/libraryIO'
import { useLibraryStore } from '@/services/library/libraryStore'
import { summarizeStale, type StaleArtifact, type StaleReason } from '@/services/library/artifactCleanup'
import { deleteStaleArtifacts, scanStaleArtifacts } from '@/services/library/artifactCleanupService'
import { formatFileSize } from '@/utils/file'

/** 展示顺序沿用既有三类，新增的「已过时」放最后 */
const REASONS: StaleReason[] = ['legacy', 'dangling', 'orphan', 'stale']

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'error'; reason: 'no-books' | 'scan-failed' | 'unavailable'; error?: string }
  | { kind: 'ready'; items: StaleArtifact[]; syncPath: string }

/**
 * 清理 WebDAV 上过时的处理产物。判断「书不在了」的唯一依据是扫描，所以先强制重扫一次，
 * 扫描不成功 / 一本书都没扫到（多半目录配错）时拒绝给清单；删除只针对用户勾选的、且只删产物文件，不碰书。
 *
 * 两类目标：与书同级的旧式产物，以及 `.juhua/books` 下的信封包（整包 = 书已不在，单份 = 已过时）。
 * 含笔记的整包默认不勾选，并在确认框里再警示一次。
 */
export function ArtifactCleanup() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const scan = useCallback(async () => {
    setState({ kind: 'scanning' })
    const io = createLibraryIO()
    if (!io) return setState({ kind: 'error', reason: 'unavailable' })
    // 先重扫：旧扫描里的「没有」不能当结论
    await useLibraryStore.getState().refresh()
    const s = useLibraryStore.getState()
    if (!s.fresh) return setState({ kind: 'error', reason: 'scan-failed', error: s.error ?? undefined })
    const r = await scanStaleArtifacts(io, s.index, s.catalog)
    if (!r.ok) return setState({ kind: 'error', reason: r.reason, error: r.error })
    setState({ kind: 'ready', items: r.items, syncPath: io.syncPath })
    setPicked(new Set(r.items.filter((i) => i.recommended).map((i) => i.path)))
  }, [])

  const items = state.kind === 'ready' ? state.items : []
  const chosen = items.filter((i) => picked.has(i.path))
  const chosenBytes = chosen.reduce((n, i) => n + i.size, 0)
  const chosenNotes = chosen.some((i) => i.hasNotes)
  const toggle = (path: string, on: boolean) => setPicked((p) => new Set(on ? [...p, path] : [...p].filter((x) => x !== path)))

  const doDelete = async () => {
    setConfirm(false)
    setDeleting(true)
    // 用本次扫描的 syncPath 再校验一次包含性：不在这个目录下的条目会被服务层拒绝删除
    const r = await deleteStaleArtifacts(chosen, undefined, 3, undefined, state.kind === 'ready' ? state.syncPath : '')
    setDeleting(false)
    if (r.failed.length) toast.error(t('library.artifacts.partial', { ok: r.deleted.length, fail: r.failed.length }))
    else toast.success(t('library.artifacts.deleted', { count: r.deleted.length }))
    void scan()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true)
          void scan()
        }}
      >
        {t('library.artifacts.open')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('library.artifacts.title')}</DialogTitle>
            <DialogDescription>{t('library.artifacts.desc')}</DialogDescription>
          </DialogHeader>

          {state.kind === 'scanning' && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              {t('library.artifacts.scanning')}
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className="py-4 text-sm text-destructive">
              {t(`library.artifacts.error.${state.reason}`)}
              {state.error ? `：${state.error}` : ''}
            </p>
          )}
          {state.kind === 'ready' && items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('library.artifacts.none')}</p>}

          {state.kind === 'ready' &&
            REASONS.map((reason) => {
              const group = items.filter((i) => i.reason === reason)
              if (!group.length) return null
              const sum = summarizeStale(group)
              return (
                <section key={reason} className="space-y-1.5">
                  <SectionHeading
                    role="label"
                    title={`${t(`library.artifacts.reason.${reason}`)} · ${sum.count} · ${formatFileSize(sum.bytes)}`}
                  />
                  <p className="t-caption">{t(`library.artifacts.reasonHint.${reason}`)}</p>
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {group.map((i) => (
                      <li key={i.path} className="flex items-center gap-2 text-xs">
                        <Checkbox checked={picked.has(i.path)} onCheckedChange={(v) => toggle(i.path, v === true)} aria-label={i.basename} />
                        {i.dir ? <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                        {i.hasNotes ? (
                          <span className="shrink-0 text-warning" title={t('library.artifacts.notesWarn')}>
                            <StickyNote className="size-3.5" aria-hidden />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate" title={i.path}>
                          {i.basename}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatFileSize(i.size)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
            <Button variant="destructive" disabled={!chosen.length || deleting} onClick={() => setConfirm(true)}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('library.artifacts.delete', { count: chosen.length, size: formatFileSize(chosenBytes) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('library.artifacts.confirmTitle', { count: chosen.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t('library.artifacts.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {chosenNotes ? <p className="text-xs text-warning">{t('library.artifacts.notesWarn')}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()}>{t('library.artifacts.confirmDelete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
