// 单个服务商卡片：概要信息 + 使用 / 编辑 / 刷新模型 / 删除 + 可展开的模型列表
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Edit, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProviderEntry } from '../../../types/ai'
import { ProviderIcon } from './ProviderIcon'
import { ProviderModelList } from './ProviderModelList'

const PROTOCOL_LABEL: Record<ProviderEntry['type'], string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
}

interface ProviderCardProps {
  provider: ProviderEntry
  /** 当前模型属于该服务商时为其 id */
  activeModelId: string | null
  defaultTemperature: number
  refreshing: boolean
  onUse: () => void
  onEdit: () => void
  onRefresh: () => void
  onDelete: () => void
}

export function ProviderCard({
  provider,
  activeModelId,
  defaultTemperature,
  refreshing,
  onUse,
  onEdit,
  onRefresh,
  onDelete,
}: ProviderCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const isActive = activeModelId !== null
  const enabledCount = provider.models.filter((m) => m.enabled).length
  const activeModel = isActive ? provider.models.find((m) => m.id === activeModelId) : undefined
  const keyLabel =
    provider.type === 'ollama'
      ? t('aiProvider.keyNotNeeded')
      : provider.apiKey?.hasSecret
        ? t('aiProvider.keyConfigured')
        : t('aiProvider.keyMissing')
  const keyMissing = provider.type !== 'ollama' && !provider.apiKey?.hasSecret

  return (
    <div
      className={`rounded-lg border transition-colors ${isActive ? 'border-primary bg-primary/5' : 'border-border'}`}
    >
      <div className="space-y-2 p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 text-muted-foreground">
            <ProviderIcon provider={provider.type} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-medium">{provider.name}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-xs">
                {PROTOCOL_LABEL[provider.type]}
              </Badge>
              {activeModel && (
                <Badge className="max-w-full px-1.5 py-0 text-xs" title={activeModel.id}>
                  <span className="truncate">{t('aiProvider.currentModelBadge', { model: activeModel.label || activeModel.id })}</span>
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={provider.baseUrl}>
              {provider.baseUrl}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{t('aiProvider.modelCount', { enabled: enabledCount, total: provider.models.length })}</span>
              <span className={`inline-flex items-center gap-1 ${keyMissing ? 'text-destructive' : ''}`}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                {keyLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={isActive ? 'default' : 'outline'}
            className="h-8 px-3 text-xs"
            onClick={onUse}
            disabled={isActive || enabledCount === 0}
            title={enabledCount === 0 ? t('aiProvider.noEnabledModels') : undefined}
          >
            {isActive ? t('aiProvider.inUse') : t('aiProvider.use')}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onEdit}>
            <Edit className="mr-1 h-3.5 w-3.5" />
            {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {t('aiProvider.refreshModels')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`${t('common.delete')} ${provider.name}`}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {t('common.delete')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={listId}
          >
            {t('aiProvider.models.toggle', { count: provider.models.length })}
            <ChevronDown
              className={`ml-1 h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
            />
          </Button>
        </div>
      </div>

      {expanded && (
        <div id={listId} className="px-3 pb-3">
          <ProviderModelList provider={provider} activeModelId={activeModelId} defaultTemperature={defaultTemperature} />
        </div>
      )}
    </div>
  )
}
