import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { filterCommands, type Command } from '@/reading/commands'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: readonly Command[]
}

/** Ctrl/⌘+K 命令面板：跳章节、找实体、切页签、执行操作。↑↓ 选择，Enter 执行，Esc 关闭 */
export function CommandPalette({ open, onOpenChange, commands }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const results = useMemo(() => filterCommands(commands, query), [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, results])

  const run = (c: Command | undefined) => {
    if (!c) return
    onOpenChange(false)
    // 等对话框关闭、焦点归还后再执行（跳转 / 聚焦才不会被抢）
    window.setTimeout(c.run, 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] max-w-lg translate-y-0 gap-2 p-3" aria-describedby="cmd-desc">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('palette.title')}</DialogTitle>
          <DialogDescription id="cmd-desc">{t('palette.description')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="cmd-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          value={query}
          placeholder={t('palette.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(results[active])
            }
          }}
        />
        <ul id="cmd-list" ref={listRef} role="listbox" className="max-h-72 space-y-0.5 overflow-y-auto">
          {results.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">{t('palette.empty')}</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
              className={cn('flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm', i === active && 'bg-accent text-accent-foreground')}
            >
              <span className="min-w-0 truncate">{c.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{c.hint ?? t(`palette.group.${c.group}`)}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
