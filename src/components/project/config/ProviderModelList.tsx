// 服务商下的模型列表：启用开关 / 单模型温度 / 删除 / 手动添加；模型多时可筛选
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import type { ProviderEntry, ProviderModel } from '../../../types/ai'
import { useAIConfigStore } from '../../../stores/ai-config'
import { TemperatureInput } from './TemperatureInput'
import { formatContext, modelLabelOf, priceOf, reconcileActiveModel } from './provider-utils'

/** 超过这个数量才显示筛选框 */
const FILTER_THRESHOLD = 8

interface ModelRowProps {
  provider: ProviderEntry
  model: ProviderModel
  isActive: boolean
  defaultTemperature: number
}

function ModelRow({ provider, model, isActive, defaultTemperature }: ModelRowProps) {
  const { t } = useTranslation()
  const setModelEnabled = useAIConfigStore((s) => s.setModelEnabled)
  const setModelTemperature = useAIConfigStore((s) => s.setModelTemperature)
  const removeModel = useAIConfigStore((s) => s.removeModel)

  const label = modelLabelOf(model)
  const context = formatContext(model.meta?.context)
  const price = priceOf(model.meta)
  const supportsTemperature = model.meta?.temperature !== false
  const switchId = `model-enabled-${provider.id}-${model.id}`

  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${model.enabled ? '' : 'text-muted-foreground'}`}
    >
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={switchId} className="min-w-0 truncate text-sm font-medium" title={model.id}>
            {label}
          </label>
          {isActive && <Badge className="px-1.5 py-0 text-xs">{t('aiProvider.current')}</Badge>}
          {model.source === 'manual' && (
            <Badge variant="outline" className="px-1.5 py-0 text-xs">
              {t('aiProvider.models.manual')}
            </Badge>
          )}
          {model.meta?.reasoning && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs">
              {t('aiProvider.models.reasoning')}
            </Badge>
          )}
          {model.meta?.temperature === true && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs">
              {t('aiProvider.models.temperature')}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {label !== model.id && <span className="min-w-0 truncate font-mono">{model.id}</span>}
          {context && <span>{t('aiProvider.models.context', { value: context })}</span>}
          <span>
            {price ? t('aiProvider.models.price', { input: price[0], output: price[1] }) : t('aiProvider.models.unpriced')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TemperatureInput
          value={model.temperature}
          optional
          disabled={!supportsTemperature}
          placeholder={t('aiProvider.models.temperaturePlaceholder', { value: defaultTemperature })}
          aria-label={t('aiProvider.models.temperatureFor', { model: label })}
          className="w-24"
          onCommit={(v) => setModelTemperature(provider.id, model.id, v)}
        />
        <Switch
          id={switchId}
          checked={model.enabled}
          onCheckedChange={(checked) => {
            setModelEnabled(provider.id, model.id, checked)
            if (!checked) reconcileActiveModel()
          }}
          aria-label={t('aiProvider.models.enableFor', { model: label })}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => {
            removeModel(provider.id, model.id)
            reconcileActiveModel()
          }}
          aria-label={t('aiProvider.models.removeFor', { model: label })}
          title={t('common.delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  )
}

function ManualModelAdd({ provider }: { provider: ProviderEntry }) {
  const { t } = useTranslation()
  const addManualModel = useAIConfigStore((s) => s.addManualModel)
  const [draft, setDraft] = useState('')
  const id = draft.trim()
  const exists = provider.models.some((m) => m.id === id)
  const inputId = `manual-model-${provider.id}`

  const submit = () => {
    if (!id || exists) return
    addManualModel(provider.id, id)
    // 第一个模型：自动成为当前模型
    reconcileActiveModel()
    setDraft('')
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t('aiProvider.models.manualAdd')}
      </label>
      <Input
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('aiProvider.models.manualPlaceholder')}
        className="h-8 min-w-0 flex-1 basis-40 font-mono text-sm"
        aria-invalid={exists || undefined}
      />
      <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!id || exists}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {exists ? t('aiProvider.models.exists') : t('aiProvider.models.manualAdd')}
      </Button>
    </form>
  )
}

interface ProviderModelListProps {
  provider: ProviderEntry
  activeModelId: string | null
  defaultTemperature: number
}

export function ProviderModelList({ provider, activeModelId, defaultTemperature }: ProviderModelListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const filterable = provider.models.length > FILTER_THRESHOLD

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return provider.models
    return provider.models.filter((m) => m.id.toLowerCase().includes(q) || m.label?.toLowerCase().includes(q))
  }, [provider.models, query])

  return (
    <div className="rounded-md border bg-background">
      {filterable && (
        <div className="relative border-b px-3 py-2">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('aiProvider.models.filterPlaceholder')}
            aria-label={t('aiProvider.models.filterPlaceholder')}
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

      {provider.models.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('aiProvider.models.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('aiProvider.models.noMatch')}</p>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto">
          {visible.map((model) => (
            <ModelRow
              key={model.id}
              provider={provider}
              model={model}
              isActive={model.id === activeModelId}
              defaultTemperature={defaultTemperature}
            />
          ))}
        </ul>
      )}

      <ManualModelAdd provider={provider} />
    </div>
  )
}
