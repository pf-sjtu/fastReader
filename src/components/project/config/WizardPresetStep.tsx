// 向导第一步：选择服务商（3 个通用入口 + models.dev 预设，可搜索）
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SectionHeading } from '@/components/ui/section-heading'
import type { CatalogPreset } from '../../../services/ai/catalog'
import type { AIProtocol } from '../../../types/ai'
import type { CatalogState } from './useCatalog'
import { ProviderIcon } from './ProviderIcon'
import { FIXED_PRESETS } from './provider-utils'

export interface PresetChoice {
  type: AIProtocol
  name: string
  baseUrl: string
  catalogId?: string
}

/** 目录预设很多（200+），渲染上限，靠搜索缩小范围 */
const MAX_PRESETS_SHOWN = 60

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface OptionButtonProps {
  icon: AIProtocol
  title: string
  subtitle: string
  meta?: string
  onClick: () => void
}

function OptionButton({ icon, title, subtitle, meta, onClick }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="text-muted-foreground">
        <ProviderIcon provider={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

interface WizardPresetStepProps {
  catalog: CatalogState
  onPick: (choice: PresetChoice) => void
}

export function WizardPresetStep({ catalog, onPick }: WizardPresetStepProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const presets: CatalogPreset[] = catalog.presets
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? presets.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q) || p.api.toLowerCase().includes(q))
      : presets
    return list
  }, [presets, query])

  const fixedSubtitle: Record<AIProtocol, string> = {
    openai: t('aiProvider.wizard.fixed.openaiDesc'),
    gemini: t('aiProvider.wizard.fixed.geminiDesc'),
    ollama: t('aiProvider.wizard.fixed.ollamaDesc'),
    anthropic: t('aiProvider.wizard.fixed.anthropicDesc'),
  }
  const fixedTitle: Record<AIProtocol, string> = {
    openai: t('aiProvider.wizard.fixed.openai'),
    gemini: t('aiProvider.wizard.fixed.gemini'),
    ollama: t('aiProvider.wizard.fixed.ollama'),
    anthropic: t('aiProvider.wizard.fixed.anthropic'),
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-labelledby="wizard-generic">
        <SectionHeading role="label" id="wizard-generic" title={t('aiProvider.wizard.generic')} />
        <div className="grid gap-2 sm:grid-cols-3">
          {FIXED_PRESETS.map((p) => (
            <OptionButton
              key={p.key}
              icon={p.type}
              title={fixedTitle[p.key]}
              subtitle={fixedSubtitle[p.key]}
              onClick={() =>
                onPick({
                  type: p.type,
                  // OpenAI 兼容：多数是第三方网关，名称与地址留空让用户填
                  name: p.key === 'openai' ? '' : p.name,
                  baseUrl: p.key === 'openai' ? '' : p.baseUrl,
                  ...(p.key !== 'openai' && p.catalogId ? { catalogId: p.catalogId } : {}),
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="wizard-presets">
        <SectionHeading
          role="label"
          id="wizard-presets"
          title={t('aiProvider.wizard.presets')}
          action={
            catalog.status === 'ready' && (
              <span className="text-xs text-muted-foreground">{t('aiProvider.wizard.presetCount', { count: presets.length })}</span>
            )
          }
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('aiProvider.wizard.searchPresets')}
            aria-label={t('aiProvider.wizard.searchPresets')}
            className="h-9 pl-8"
            disabled={catalog.status !== 'ready'}
          />
        </div>

        {catalog.status === 'loading' || catalog.status === 'idle' ? (
          <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            {t('aiProvider.wizard.catalogLoading')}
          </p>
        ) : catalog.status === 'error' ? (
          <p className="py-3 text-xs text-muted-foreground" role="status">
            {t('aiProvider.wizard.catalogFailed')}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">{t('aiProvider.wizard.noPresetMatch')}</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.slice(0, MAX_PRESETS_SHOWN).map((p) => (
              <OptionButton
                key={p.id}
                icon="openai"
                title={p.name}
                subtitle={hostOf(p.api)}
                meta={t('aiProvider.wizard.presetModels', { count: p.modelCount })}
                onClick={() => onPick({ type: 'openai', name: p.name, baseUrl: p.api, catalogId: p.id })}
              />
            ))}
            {filtered.length > MAX_PRESETS_SHOWN && (
              <p className="pt-1 text-center text-xs text-muted-foreground">
                {t('aiProvider.wizard.morePresets', { count: filtered.length - MAX_PRESETS_SHOWN })}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
