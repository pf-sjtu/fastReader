// 向导第二步：地址 / 名称 / 密钥 + 获取模型（失败时可手动填写模型 ID）
import { useTranslation } from 'react-i18next'
import { AlertCircle, Download, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AIProtocol } from '../../../types/ai'
import { defaultBaseUrlForProtocol, type BaseUrlIssue } from './provider-utils'
import { ModelChecklist } from './ModelChecklist'

export interface WizardDraft {
  type: AIProtocol
  name: string
  baseUrl: string
  catalogId?: string
  /** 新输入的密钥；空 = 保持不变（编辑时）或不设置（新建时） */
  apiKey: string
  /** 可选模型（获取结果 ∪ 已有模型） */
  modelIds: string[]
  selected: Set<string>
  /** 手动填写的模型 ID（逗号 / 换行分隔） */
  manualIds: string
}

export type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; count: number }
  | { status: 'error'; message: string }

interface WizardCredentialsStepProps {
  draft: WizardDraft
  isEdit: boolean
  hasStoredKey: boolean
  baseUrlIssue: BaseUrlIssue
  showErrors: boolean
  fetchState: FetchState
  showManual: boolean
  onChange: (patch: Partial<WizardDraft>) => void
  onFetch: () => void
  onShowManual: () => void
}

export function WizardCredentialsStep({
  draft,
  isEdit,
  hasStoredKey,
  baseUrlIssue,
  showErrors,
  fetchState,
  showManual,
  onChange,
  onFetch,
  onShowManual,
}: WizardCredentialsStepProps) {
  const { t } = useTranslation()
  const isOllama = draft.type === 'ollama'
  const urlError = showErrors || (baseUrlIssue !== 'required' && draft.baseUrl.trim().length > 0) ? baseUrlIssue : null
  const loading = fetchState.status === 'loading'

  return (
    <div className="space-y-4">
      {isOllama && (
        <p className="flex items-start gap-2 rounded-md border bg-muted px-3 py-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {t('aiProvider.wizard.ollamaHint')}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wizard-base-url" className="text-xs">
            {t('aiProvider.wizard.baseUrl')}
          </Label>
          <Input
            id="wizard-base-url"
            value={draft.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder={defaultBaseUrlForProtocol(draft.type)}
            className="font-mono text-sm"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'wizard-base-url-error' : 'wizard-base-url-hint'}
          />
          {urlError ? (
            <p id="wizard-base-url-error" className="text-xs text-destructive">
              {t(`aiProvider.wizard.baseUrlIssue.${urlError}`)}
            </p>
          ) : (
            <p id="wizard-base-url-hint" className="text-xs text-muted-foreground">
              {isOllama ? t('aiProvider.wizard.baseUrlHintOllama') : t('aiProvider.wizard.baseUrlHint')}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wizard-name" className="text-xs">
            {t('aiProvider.wizard.name')}
          </Label>
          <Input
            id="wizard-name"
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('aiProvider.wizard.namePlaceholder')}
            autoComplete="off"
          />
        </div>

        {!isOllama && (
          <div className="space-y-1.5">
            <Label htmlFor="wizard-api-key" className="text-xs">
              {t('aiProvider.apiKey')}
            </Label>
            <Input
              id="wizard-api-key"
              type="password"
              value={draft.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder={isEdit && hasStoredKey ? t('aiProvider.wizard.keyKeep') : t('aiProvider.apiKeyPlaceholder')}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <section className="space-y-2" aria-labelledby="wizard-models">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="wizard-models" className="text-sm font-medium">
            {t('aiProvider.wizard.models')}
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={onFetch} disabled={loading || baseUrlIssue !== null}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            {loading ? t('aiProvider.wizard.fetching') : t('aiProvider.wizard.fetchModels')}
          </Button>
        </div>

        <div aria-live="polite">
          {fetchState.status === 'error' && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {t('aiProvider.wizard.fetchFailed', { error: fetchState.message })}
              </span>
            </p>
          )}
          {fetchState.status === 'done' && (
            <p className="text-xs text-muted-foreground">{t('aiProvider.wizard.fetched', { count: fetchState.count })}</p>
          )}
        </div>

        {draft.modelIds.length > 0 ? (
          <ModelChecklist ids={draft.modelIds} selected={draft.selected} onChange={(selected) => onChange({ selected })} />
        ) : (
          fetchState.status !== 'error' && (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              {t('aiProvider.wizard.modelsEmpty')}
            </p>
          )
        )}

        {showManual ? (
          <div className="space-y-1.5">
            <Label htmlFor="wizard-manual-ids" className="text-xs">
              {t('aiProvider.wizard.manualIds')}
            </Label>
            <Textarea
              id="wizard-manual-ids"
              value={draft.manualIds}
              onChange={(e) => onChange({ manualIds: e.target.value })}
              placeholder={t('aiProvider.wizard.manualIdsPlaceholder')}
              className="min-h-16 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        ) : (
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onShowManual}>
            {t('aiProvider.wizard.manualToggle')}
          </Button>
        )}
      </section>
    </div>
  )
}
