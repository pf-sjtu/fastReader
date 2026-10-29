// 可搜索的模型勾选列表（向导用）：全选 / 全不选只作用于当前筛选结果
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

/** 网关可能返回上千个模型：只渲染前若干条，靠搜索缩小 */
const MAX_ROWS = 300

interface ModelChecklistProps {
  ids: string[]
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}

export function ModelChecklist({ ids, selected, onChange }: ModelChecklistProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? ids.filter((id) => id.toLowerCase().includes(q)) : ids
  }, [ids, query])

  const setMany = (list: string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of list) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <div className="relative min-w-0 flex-1 basis-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('aiProvider.models.filterPlaceholder')}
            aria-label={t('aiProvider.models.filterPlaceholder')}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setMany(visible, true)}>
            {t('aiProvider.wizard.selectAll')}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setMany(visible, false)}>
            {t('aiProvider.wizard.selectNone')}
          </Button>
        </div>
        <span className="w-full text-xs text-muted-foreground" aria-live="polite">
          {t('aiProvider.wizard.selectedCount', { selected: selected.size, total: ids.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('aiProvider.models.noMatch')}</p>
      ) : (
        <ul className="max-h-60 overflow-y-auto py-1">
          {visible.slice(0, MAX_ROWS).map((id) => {
            const checkboxId = `wizard-model-${id}`
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/60">
                <Checkbox
                  id={checkboxId}
                  checked={selected.has(id)}
                  onCheckedChange={(checked) => setMany([id], checked === true)}
                />
                <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer truncate font-mono text-xs" title={id}>
                  {id}
                </label>
              </li>
            )
          })}
          {visible.length > MAX_ROWS && (
            <li className="px-3 py-1.5 text-center text-xs text-muted-foreground">
              {t('aiProvider.wizard.moreModels', { count: visible.length - MAX_ROWS })}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
