// 状态栏里的「当前模型 + 思考强度」切换器：点开即可换模型、调思考强度，不必进设置页
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Check, ChevronDown, KeyRound, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAIConfigStore } from '../stores/ai-config'
import { REASONING_EFFORTS, type ReasoningEffort } from '../types/ai'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export interface ModelSwitcherProps {
  disabled?: boolean
  tokenUsage?: number
  className?: string
}

export function ModelSwitcher({ disabled, tokenUsage = 0, className }: ModelSwitcherProps) {
  const { t } = useTranslation()
  const providers = useAIConfigStore((s) => s.ai.providers)
  const active = useAIConfigStore((s) => s.ai.active)
  const effort = useAIConfigStore((s) => s.ai.reasoningEffort ?? 'auto')
  const runtime = useAIConfigStore((s) => s.aiConfig)
  const setActiveModel = useAIConfigStore((s) => s.setActiveModel)
  const setReasoningEffort = useAIConfigStore((s) => s.setReasoningEffort)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers
      .map((p) => ({
        provider: p,
        models: p.models.filter(
          (m) => m.enabled && (!q || m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.models.length > 0)
  }, [providers, query])

  const activeProvider = providers.find((p) => p.id === active.providerId)
  const activeModel = activeProvider?.models.find((m) => m.id === active.modelId)
  const label = activeModel?.label || activeModel?.id || runtime.model || t('modelSwitcher.none')
  const missingKey = runtime.hasCredentials !== true

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery('')}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          size="sm"
          className={cn('max-w-[18rem] gap-1.5 px-2.5 font-normal', missingKey && 'border-destructive/50 text-destructive', className)}
          aria-label={t('modelSwitcher.trigger', { model: label })}
        >
          {missingKey ? <KeyRound className="h-3.5 w-3.5 shrink-0" /> : <Brain className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate text-xs">{missingKey ? t('statusBar.noApiKey') : label}</span>
          {effort !== 'auto' && !missingKey && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1 text-xs text-primary">{t(`modelSwitcher.effort.${effort}`)}</span>
          )}
          {tokenUsage > 0 && <span className="shrink-0 text-xs text-muted-foreground">{formatTokens(tokenUsage)}</span>}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* 思考强度 */}
        <div className="space-y-1.5 p-3">
          <DropdownMenuLabel className="p-0 text-xs font-medium">{t('modelSwitcher.effortLabel')}</DropdownMenuLabel>
          <div role="radiogroup" aria-label={t('modelSwitcher.effortLabel')} className="grid grid-cols-5 gap-1 rounded-md bg-muted p-0.5">
            {REASONING_EFFORTS.map((value: ReasoningEffort) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={effort === value}
                onClick={() => setReasoningEffort(value)}
                className={cn(
                  'rounded-md px-1 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  effort === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`modelSwitcher.effort.${value}`)}
              </button>
            ))}
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{t('modelSwitcher.effortHint')}</p>
        </div>

        <DropdownMenuSeparator className="m-0" />

        {/* 模型 */}
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // 下拉菜单会抢走方向键与字母键：输入框里阻止冒泡才能正常打字
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={t('modelSwitcher.search')}
              className="h-8 pl-7 text-xs"
              aria-label={t('modelSwitcher.search')}
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto px-1 pb-1" role="listbox" aria-label={t('modelSwitcher.models')}>
          {groups.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('aiProvider.noEnabledModels')}</p>}
          {groups.map(({ provider, models }) => (
            <div key={provider.id} className="py-1">
              <div className="flex items-center justify-between px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="truncate">{provider.name}</span>
                {!provider.apiKey?.hasSecret && provider.type !== 'ollama' && (
                  <span className="text-destructive normal-case">{t('statusBar.noApiKey')}</span>
                )}
              </div>
              {models.map((model) => {
                const selected = provider.id === active.providerId && model.id === active.modelId
                const ctx = model.meta?.context
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setActiveModel(provider.id, model.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
                      selected && 'bg-accent/60'
                    )}
                  >
                    <Check className={cn('h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1 truncate">{model.label || model.id}</span>
                    {model.meta?.reasoning && <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t('modelSwitcher.reasoning')} />}
                    {typeof ctx === 'number' && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ctx >= 1_000_000 ? `${Math.round(ctx / 100_000) / 10}M` : `${Math.round(ctx / 1000)}K`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
