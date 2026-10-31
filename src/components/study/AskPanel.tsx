import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useStudyStore } from '@/study/studyStore'
import type { BookSummary } from '@/types/book'

interface Props {
  bookSummary: BookSummary
  onJumpChapter: (chapterId: string) => void
}

/**
 * 问书：只依据本书的章节总结回答，答案里的【章节】可点击跳转。
 * 每次提问调用一次模型（用户主动触发）；对话只存内存，换书即清空。
 */
export function AskPanel({ bookSummary, onJumpChapter }: Props) {
  const { t } = useTranslation()
  const { chat, running, ask, clearChat, cancel } = useStudyStore()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const titleOf = (id: string) => bookSummary.chapters.find((c) => c.id === id)?.title ?? id

  // 新回答出现时滚到底（尊重 reduced-motion：不用平滑滚动）
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [chat])

  const send = () => {
    const q = text.trim()
    if (!q || running.ask) return
    setText('')
    void ask(bookSummary, q)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送；Shift+Enter 换行；输入法组字中不发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex min-h-[18rem] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('study.ask.hint')}</p>
        {chat.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={clearChat}>
            <Trash2 className="size-3" />
            {t('study.ask.clear')}
          </Button>
        )}
      </div>

      <ol className="flex-1 space-y-3" aria-live="polite">
        {chat.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t('study.ask.empty')}</li>}
        {chat.map((turn) => (
          <li key={turn.id} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground">{turn.question}</p>
            <div className={cn('max-w-[95%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-sm leading-relaxed', turn.error && 'border-destructive/50')}>
              {turn.pending ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('study.ask.thinking')}
                </span>
              ) : turn.error ? (
                <span className="text-destructive">{turn.error === 'aborted' ? t('study.ask.aborted') : t('study.failed', { error: turn.error })}</span>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words">{turn.answer}</p>
                  {turn.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                      <span className="text-xs text-muted-foreground">{t('study.ask.sources')}</span>
                      {turn.citations.map((id) => (
                        <button key={id} type="button" onClick={() => onJumpChapter(id)} className="min-h-6 rounded-full border px-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                          {titleOf(id)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
        <div ref={endRef} />
      </ol>

      <div className="sticky bottom-0 flex items-end gap-2 bg-background/90 pt-1 backdrop-blur">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t('study.ask.placeholder')}
          aria-label={t('study.ask.placeholder')}
          className="min-h-10 resize-none"
        />
        {running.ask ? (
          <Button size="icon" variant="outline" className="size-10 shrink-0" onClick={cancel} aria-label={t('study.cancel')} title={t('study.cancel')}>
            <Loader2 className="size-4 animate-spin" />
          </Button>
        ) : (
          <Button size="icon" className="size-10 shrink-0" disabled={!text.trim()} onClick={send} aria-label={t('study.ask.send')} title={t('study.ask.send')}>
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
