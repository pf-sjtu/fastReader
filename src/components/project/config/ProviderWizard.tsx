// 服务商创建 / 编辑向导：① 选择服务商 → ② 凭据与模型。草稿在本地，点保存才写入 store；有未保存改动时关闭需确认
// 父组件每次打开时换 key 重新挂载，草稿从 props 初始化
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ProviderEntry, ProviderModel } from '../../../types/ai'
import { useAIConfigStore } from '../../../stores/ai-config'
import type { CatalogState } from './useCatalog'
import { WizardPresetStep, type PresetChoice } from './WizardPresetStep'
import { WizardCredentialsStep, type FetchState, type WizardDraft } from './WizardCredentialsStep'
import {
  checkBaseUrl,
  describeFetchError,
  fetchProviderModelIds,
  nameFromBaseUrl,
  parseModelIds,
  reconcileActiveModel,
} from './provider-utils'

/** 首次获取时模型不多就默认全选；多（网关常见上百个）则让用户挑 */
const AUTO_SELECT_LIMIT = 30

type Step = 1 | 2

function initialDraft(provider: ProviderEntry | undefined): WizardDraft {
  if (!provider) {
    return { type: 'openai', name: '', baseUrl: '', apiKey: '', modelIds: [], selected: new Set(), manualIds: '' }
  }
  return {
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl,
    ...(provider.catalogId ? { catalogId: provider.catalogId } : {}),
    apiKey: '',
    modelIds: provider.models.map((m) => m.id),
    selected: new Set(provider.models.map((m) => m.id)),
    manualIds: '',
  }
}

/** 用于脏检查的稳定序列化（Set 转有序数组） */
function snapshot(draft: WizardDraft): string {
  return JSON.stringify({ ...draft, selected: [...draft.selected].sort(), modelIds: [...draft.modelIds].sort() })
}

interface ProviderWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑时传入；不传为新建 */
  provider?: ProviderEntry
  catalog: CatalogState
}

export function ProviderWizard({ open, onOpenChange, provider, catalog }: ProviderWizardProps) {
  const { t } = useTranslation()
  const isEdit = !!provider
  const [step, setStep] = useState<Step>(isEdit ? 2 : 1)
  const [draft, setDraft] = useState<WizardDraft>(() => initialDraft(provider))
  const [initial] = useState(() => snapshot(initialDraft(provider)))
  const [nameTouched, setNameTouched] = useState(isEdit)
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' })
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  const baseUrlIssue = checkBaseUrl(draft.type, draft.baseUrl)
  const isDirty = useMemo(() => snapshot(draft) !== initial, [draft, initial])

  const update = (patch: Partial<WizardDraft>) => {
    if ('name' in patch) setNameTouched(true)
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const handlePick = (choice: PresetChoice) => {
    setDraft((prev) => ({
      ...prev,
      type: choice.type,
      baseUrl: choice.baseUrl,
      catalogId: choice.catalogId,
      name: nameTouched ? prev.name : choice.name,
      // 换了服务商，之前获取的列表不再适用（编辑时保留已有模型）
      modelIds: isEdit ? prev.modelIds.filter((id) => provider.models.some((m) => m.id === id)) : [],
      selected: isEdit ? prev.selected : new Set(),
    }))
    setFetchState({ status: 'idle' })
    setShowErrors(false)
    setStep(2)
  }

  const handleFetch = async () => {
    if (baseUrlIssue) {
      setShowErrors(true)
      return
    }
    setFetchState({ status: 'loading' })
    const apiKey = draft.apiKey.trim()
    // 只在地址未变时让服务端使用已存储的密钥，避免把旧密钥发往新地址
    const sameBase = isEdit && provider.baseUrl.trim() === draft.baseUrl.trim()
    try {
      const ids = await fetchProviderModelIds({
        ...(isEdit && (sameBase || apiKey) ? { providerId: provider.id } : {}),
        type: draft.type,
        baseUrl: draft.baseUrl,
        ...(apiKey && draft.type !== 'ollama' ? { apiKey } : {}),
      })
      setDraft((prev) => {
        const fetched = new Set(ids)
        const modelIds = [...ids, ...prev.modelIds.filter((id) => !fetched.has(id))]
        const selected =
          prev.selected.size === 0 && ids.length <= AUTO_SELECT_LIMIT ? new Set(ids) : new Set(prev.selected)
        return { ...prev, modelIds, selected }
      })
      setFetchedAt(new Date().toISOString())
      setFetchState({ status: 'done', count: ids.length })
    } catch (error) {
      setFetchState({ status: 'error', message: describeFetchError(error, t) })
      setShowManual(true)
    }
  }

  const handleSave = () => {
    if (baseUrlIssue) {
      setShowErrors(true)
      toast.error(t(`aiProvider.wizard.baseUrlIssue.${baseUrlIssue}`))
      return
    }
    const store = useAIConfigStore.getState()
    const manual = parseModelIds(draft.manualIds)
    const picked = draft.modelIds.filter((id) => draft.selected.has(id))
    const ids = [...new Set([...picked, ...manual])]
    const fetchedSet = new Set(fetchState.status === 'done' ? draft.modelIds : [])
    const existing = new Map((provider?.models ?? []).map((m) => [m.id, m]))
    const models: ProviderModel[] = ids.map(
      (id) =>
        existing.get(id) ?? {
          id,
          enabled: true,
          source: fetchedSet.has(id) && !manual.includes(id) ? 'auto' : 'manual',
        }
    )

    const fields = {
      name: draft.name.trim() || nameFromBaseUrl(draft.baseUrl),
      type: draft.type,
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      ...(draft.catalogId ? { catalogId: draft.catalogId } : {}),
      ...(fetchedAt ? { modelsFetchedAt: fetchedAt } : {}),
    }

    let id: string
    if (provider) {
      id = provider.id
      store.updateProvider(id, { ...fields, catalogId: draft.catalogId, models })
    } else {
      id = store.addProvider({ ...fields, models })
    }

    // 补齐 models.dev 元数据（目录未加载时跳过，下次刷新模型时再补）
    const saved = useAIConfigStore.getState().getProvider(id)
    if (saved && catalog.lib && catalog.catalog) {
      store.setProviderModels(id, catalog.lib.enrichProviderMeta(catalog.catalog, saved).models)
    }

    const apiKey = draft.apiKey.trim()
    if (apiKey && draft.type !== 'ollama') store.setProviderSecret(id, apiKey)

    reconcileActiveModel()
    toast.success(isEdit ? t('aiProvider.updated') : t('aiProvider.created'))
    if (ids.length === 0) toast.info(t('aiProvider.wizard.savedWithoutModels'))
    onOpenChange(false)
  }

  // 有未保存改动时关闭（Esc / 点遮罩 / 取消）需二次确认
  const requestClose = () => {
    if (isDirty) setConfirmDiscardOpen(true)
    else onOpenChange(false)
  }

  const title = isEdit ? t('aiProvider.editTitle') : t('aiProvider.createTitle')
  const stepTitle = step === 1 ? t('aiProvider.wizard.step1') : t('aiProvider.wizard.step2')

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="pr-6 text-wrap break-words">{title}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? stepTitle
                : t('aiProvider.wizard.stepIndicator', { current: step, total: 2, title: stepTitle })}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[62vh] min-h-0 flex-1">
            <div className="p-1 pr-3">
              {step === 1 ? (
                <WizardPresetStep catalog={catalog} onPick={handlePick} />
              ) : (
                <WizardCredentialsStep
                  draft={draft}
                  isEdit={isEdit}
                  hasStoredKey={!!provider?.apiKey?.hasSecret}
                  baseUrlIssue={baseUrlIssue}
                  showErrors={showErrors}
                  fetchState={fetchState}
                  showManual={showManual}
                  onChange={update}
                  onFetch={() => void handleFetch()}
                  onShowManual={() => setShowManual(true)}
                />
              )}
            </div>
          </ScrollArea>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            {step === 2 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                {isEdit ? t('aiProvider.wizard.changePreset') : t('aiProvider.wizard.back')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              {step === 2 && (
                <Button type="button" size="sm" onClick={handleSave} disabled={fetchState.status === 'loading'}>
                  {isEdit ? t('common.save') : t('aiProvider.create')}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('aiProvider.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('aiProvider.discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('aiProvider.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscardOpen(false)
                onOpenChange(false)
              }}
            >
              {t('aiProvider.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
