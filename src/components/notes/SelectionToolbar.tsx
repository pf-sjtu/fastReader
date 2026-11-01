import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Highlighter, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { makeNote } from '@/notes/notes'
import { useNotesStore } from '@/notes/notesStore'
import { placeCard } from '@/components/workspace/anchor'

const CARD_PREFIX = 'chapter-summary-'
const BAR = { width: 168, height: 40 }

interface Pending {
  text: string
  chapterId: string
  left: number
  top: number
}

interface Props {
  /** 正文滚动容器：只在它里面的选区才出工具条 */
  bodyEl: HTMLElement | null
  chapters: readonly { id: string; title: string; summary?: string }[]
  /** 点「批注」后：打开笔记页签 */
  onOpenNotes: () => void
}

/** 读当前选区：必须落在某一章的摘要卡片内；返回选中文字、所在章节与屏幕位置 */
function readSelection(bodyEl: HTMLElement): Pending | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const anchorEl = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
  if (!anchorEl || !bodyEl.contains(anchorEl)) return null
  const card = anchorEl.closest(`[id^="${CARD_PREFIX}"]`)
  if (!card) return null
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null
  const r = range.getBoundingClientRect()
  const pos = placeCard({ x: r.x, y: r.y, width: r.width, height: r.height }, BAR, { width: window.innerWidth, height: window.innerHeight })
  return { text, chapterId: card.id.slice(CARD_PREFIX.length), left: pos.left, top: pos.top }
}

/** 选中正文后浮出的「划线 / 批注」小工具条 */
export function SelectionToolbar({ bodyEl, chapters, onOpenNotes }: Props) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const add = useNotesStore((s) => s.add)

  useEffect(() => {
    if (!bodyEl) return
    const refresh = () => setPending(readSelection(bodyEl))
    // mouseup / keyup / touchend 之后选区才稳定
    const onUp = () => window.setTimeout(refresh, 0)
    const clear = () => setPending(null)
    bodyEl.addEventListener('mouseup', onUp)
    bodyEl.addEventListener('keyup', onUp)
    bodyEl.addEventListener('touchend', onUp)
    bodyEl.addEventListener('scroll', clear, { passive: true })
    document.addEventListener('selectionchange', () => {
      if (window.getSelection()?.isCollapsed) clear()
    })
    return () => {
      bodyEl.removeEventListener('mouseup', onUp)
      bodyEl.removeEventListener('keyup', onUp)
      bodyEl.removeEventListener('touchend', onUp)
      bodyEl.removeEventListener('scroll', clear)
    }
  }, [bodyEl])

  const commit = useCallback(
    (withComment: boolean) => {
      if (!pending) return
      const index = chapters.findIndex((c) => c.id === pending.chapterId)
      const chapter = chapters[index]
      const note = makeNote({
        chapterId: pending.chapterId,
        chapterIndex: index,
        chapterTitle: chapter?.title ?? '',
        selected: pending.text,
        chapterText: chapter?.summary,
      })
      setPending(null)
      window.getSelection()?.removeAllRanges()
      if (!note) return
      add(note, { edit: withComment })
      if (withComment) onOpenNotes()
    },
    [pending, chapters, add, onOpenNotes]
  )

  if (!pending) return null
  return (
    <div
      role="toolbar"
      aria-label={t('notes.toolbar')}
      className="fixed z-50 flex gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: pending.left, top: pending.top }}
      // 点按钮不能让选区丢失
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button size="xs" variant="ghost" onClick={() => commit(false)}>
        <Highlighter className="size-3.5" />
        {t('notes.highlight')}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => commit(true)}>
        <MessageSquarePlus className="size-3.5" />
        {t('notes.annotate')}
      </Button>
    </div>
  )
}
