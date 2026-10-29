// 「当前模型」选择器：按服务商分组，只列启用的模型；可在主界面与配置面板复用
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAIConfigStore } from '../../../stores/ai-config'
import { modelLabelOf } from './provider-utils'

/** Select 只接受字符串值：服务商 id 与模型 id 编码到一起（模型 id 可能含 / : 等字符） */
const encode = (providerId: string, modelId: string) => JSON.stringify([providerId, modelId])
function decode(value: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return [parsed[0], parsed[1]]
    }
  } catch {
    // ignore
  }
  return null
}

export interface ActiveModelSelectProps {
  className?: string
  disabled?: boolean
  /** 无障碍标签所指向的 id（与外部 <Label htmlFor> 配合） */
  id?: string
}

export function ActiveModelSelect({ className, disabled, id }: ActiveModelSelectProps) {
  const { t } = useTranslation()
  const providers = useAIConfigStore((s) => s.ai.providers)
  const active = useAIConfigStore((s) => s.ai.active)
  const setActiveModel = useAIConfigStore((s) => s.setActiveModel)

  const groups = useMemo(
    () =>
      providers
        .map((p) => ({ provider: p, models: p.models.filter((m) => m.enabled) }))
        .filter((g) => g.models.length > 0),
    [providers]
  )

  const hasActive = groups.some(
    (g) => g.provider.id === active.providerId && g.models.some((m) => m.id === active.modelId)
  )
  const value = hasActive ? encode(active.providerId, active.modelId) : ''
  const empty = groups.length === 0

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const target = decode(v)
        if (target) setActiveModel(target[0], target[1])
      }}
      disabled={disabled || empty}
    >
      <SelectTrigger
        id={id}
        size="sm"
        className={cn('w-full min-w-0 max-w-full', className)}
        aria-label={t('aiProvider.activeModel')}
      >
        <SelectValue placeholder={empty ? t('aiProvider.noEnabledModels') : t('aiProvider.selectModel')} />
      </SelectTrigger>
      <SelectContent className="max-h-80 max-w-[calc(100vw-2rem)]">
        {groups.map(({ provider, models }, i) => (
          <SelectGroup key={provider.id}>
            {i > 0 && <SelectSeparator />}
            <SelectLabel className="truncate">{provider.name}</SelectLabel>
            {models.map((model) => (
              <SelectItem key={model.id} value={encode(provider.id, model.id)} title={model.id}>
                <span className="truncate">{modelLabelOf(model)}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export default ActiveModelSelect
