import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCopy, Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { groupNotes, notesToMarkdown, MAX_COMMENT } from '@/notes/notes'
import { useNotesStore } from '@/notes/notesStore'
import { cn } from '@/lib/utils'

interface Props {
  bookTitle: string
  chapters: readonly { id: string; title: string }[]
  onJumpChapter: (chapterId: string) => void
}

const BAR = ['border-l-primary', 'border-l-info', 'border-l-success', 'border-l-warning'] as const

/** 笔记页签：按章节顺序列出划线与批注，可编辑批注、跳回章节、导出 Markdown */
export function NotesPanel({ bookTitle, chapters, onJumpChapter }: Props) {
  const { t } = useTranslation()
  const { notes, editingId, update, remove, setEditing } = useNotesStore()
  const groups = useMemo(() => groupNotes(notes, chapters), [notes, chapters])

  const markdown = () => notesToMarkdown(bookTitle, groups, { orphan: t('notes.orphan'), untitled: t('notes.untitled') })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown())
      toast.success(t('notes.copied'))
    } catch {
      toast.error(t('notes.copyFailed'))
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(bookTitle || t('notes.untitled')).replace(/[\\/:*?"<>|]/g, '_')}-笔记.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (notes.length === 0) {
    return (
      <div className="space-y-1 py-10 text-center text-sm text-muted-foreground">
        <p>{t('notes.empty')}</p>
        <p className="t-caption">{t('notes.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-caption">{t('notes.count', { count: notes.length })}</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            <ClipboardCopy className="size-3.5" />
            {t('notes.copyMd')}
          </Button>
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="size-3.5" />
            {t('notes.downloadMd')}
          </Button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.chapter?.id ?? 'orphan'} className="space-y-2">
          <h3 className="t-label">
            {g.chapter ? (
              <button type="button" className="text-left hover:underline" onClick={() => onJumpChapter(g.chapter!.id)}>
                {g.chapter.title}
              </button>
            ) : (
              t('notes.orphan')
            )}
          </h3>
          {g.notes.map((n) => (
            <article key={n.id} className={cn('space-y-1.5 rounded-md border border-l-4 bg-card p-2.5', BAR[n.color - 1])}>
              <blockquote className="text-sm leading-relaxed">{n.quote}</blockquote>
              {editingId === n.id ? (
                <Textarea
                  autoFocus
                  rows={3}
                  maxLength={MAX_COMMENT}
                  defaultValue={n.comment}
                  placeholder={t('notes.commentPlaceholder')}
                  onBlur={(e) => {
                    update(n.id, { comment: e.target.value })
                    setEditing(null)
                  }}
                />
              ) : (
                <button type="button" className="block w-full text-left text-sm text-muted-foreground hover:text-foreground" onClick={() => setEditing(n.id)}>
                  {n.comment || t('notes.addComment')}
                </button>
              )}
              <div className="flex justify-end">
                <Button size="icon-xs" variant="ghost" aria-label={t('notes.delete')} title={t('notes.delete')} onClick={() => remove(n.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
