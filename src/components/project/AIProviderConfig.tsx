// AI 服务商面板：当前模型 + 全局温度 + 服务商列表（使用 / 编辑 / 刷新模型 / 删除）；新建与编辑见 config/ProviderWizard
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle, Info, Loader2, Play, Plus, Server, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import type { ProviderEntry } from '../../types/ai'
import { useAIConfigStore } from '../../stores/ai-config'
import { ActiveModelSelect } from './config/ActiveModelSelect'
import { ProviderCard } from './config/ProviderCard'
import { ProviderWizard } from './config/ProviderWizard'
import { TemperatureInput } from './config/TemperatureInput'
import { useAIConnectionTest } from './config/useAIConnectionTest'
import { useCatalog } from './config/useCatalog'
import { describeFetchError, fetchProviderModelIds, mergeFetchedModels, reconcileActiveModel } from './config/provider-utils'

/** 向导状态：每次打开换 key，让草稿从头初始化 */
interface WizardState {
  key: number
  providerId?: string
}

function ActiveModelBar() {
  const { t } = useTranslation()
  const defaultTemperature = useAIConfigStore((s) => s.ai.defaultTemperature)
  const setDefaultTemperature = useAIConfigStore((s) => s.setDefaultTemperature)
  const hasActive = useAIConfigStore((s) => !!s.ai.active.modelId)
  const { isTesting, result, test } = useAIConnectionTest()

  return (
    <div className="space-y-3 rounded-lg border bg-muted p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="active-model-select" className="text-xs font-medium">
            {t('aiProvider.activeModel')}
          </Label>
          <ActiveModelSelect id="active-model-select" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="default-temperature" className="text-xs font-medium">
            {t('aiProvider.defaultTemperature')}
          </Label>
          <TemperatureInput
            id="default-temperature"
            value={defaultTemperature}
            onCommit={(v) => v !== undefined && setDefaultTemperature(v)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => void test()}
          disabled={isTesting || !hasActive}
        >
          {isTesting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isTesting ? t('aiProvider.testing') : t('config.testConnection')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('aiProvider.temperatureHint')}</span>
      </div>
      {result && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-xs ${result.success ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`}
        >
          {result.success ? (
            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{result.message}</span>
        </p>
      )}
    </div>
  )
}

function IntroCard() {
  const { t } = useTranslation()
  return (
    <Card className="border bg-muted/50">
      <CardContent className="p-3">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="space-y-1 text-xs text-foreground">
            <p className="text-sm font-medium">{t('aiProvider.introTitle')}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>{t('aiProvider.introOne')}</li>
              <li>{t('aiProvider.introFetch')}</li>
              <li>{t('aiProvider.introSecret')}</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AIProviderConfig() {
  const { t } = useTranslation()
  const providers = useAIConfigStore((s) => s.ai.providers)
  const active = useAIConfigStore((s) => s.ai.active)
  const defaultTemperature = useAIConfigStore((s) => s.ai.defaultTemperature)
  // 面板挂载（即页签被打开）时才拉取目录
  const catalog = useCatalog()

  const [wizard, setWizard] = useState<WizardState | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProviderEntry | null>(null)
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set())

  const openWizard = (providerId?: string) => {
    setWizard((w) => ({ key: (w?.key ?? 0) + 1, providerId }))
    setWizardOpen(true)
  }

  const handleUse = (provider: ProviderEntry) => {
    const model = provider.models.find((m) => m.enabled)
    if (!model) {
      toast.error(t('aiProvider.noEnabledModels'))
      return
    }
    useAIConfigStore.getState().setActiveModel(provider.id, model.id)
  }

  const handleRefresh = async (provider: ProviderEntry) => {
    setRefreshing((s) => new Set(s).add(provider.id))
    try {
      const ids = await fetchProviderModelIds({ providerId: provider.id, type: provider.type, baseUrl: provider.baseUrl })
      const store = useAIConfigStore.getState()
      const current = store.getProvider(provider.id)
      if (!current) return
      const { models, added, removed } = mergeFetchedModels(current.models, ids)
      const enriched =
        catalog.lib && catalog.catalog
          ? catalog.lib.enrichProviderMeta(catalog.catalog, { ...current, models }).models
          : models
      store.updateProvider(provider.id, { models: enriched, modelsFetchedAt: new Date().toISOString() })
      reconcileActiveModel()
      toast.success(t('aiProvider.refreshDone', { name: provider.name, count: ids.length }), {
        description: t('aiProvider.refreshDiff', { added, removed }),
      })
    } catch (error) {
      toast.error(t('aiProvider.refreshFailed', { name: provider.name }), { description: describeFetchError(error, t) })
    } finally {
      setRefreshing((s) => {
        const next = new Set(s)
        next.delete(provider.id)
        return next
      })
    }
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    useAIConfigStore.getState().deleteProvider(pendingDelete.id)
    reconcileActiveModel()
    toast.success(t('aiProvider.deleted', { name: pendingDelete.name }))
    setPendingDelete(null)
  }

  const editing = wizard?.providerId ? providers.find((p) => p.id === wizard.providerId) : undefined

  return (
    <div className="space-y-4">
      <ActiveModelBar />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-medium">{t('aiProvider.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('aiProvider.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => openWizard()}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('aiProvider.add')}
        </Button>
      </div>

      {providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <Server className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{t('aiProvider.emptyTitle')}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t('aiProvider.emptyDescription')}</p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => openWizard()}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('aiProvider.add')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              activeModelId={active.providerId === provider.id ? active.modelId : null}
              defaultTemperature={defaultTemperature}
              refreshing={refreshing.has(provider.id)}
              onUse={() => handleUse(provider)}
              onEdit={() => openWizard(provider.id)}
              onRefresh={() => void handleRefresh(provider)}
              onDelete={() => setPendingDelete(provider)}
            />
          ))}
        </div>
      )}

      <IntroCard />

      {wizard && (
        <ProviderWizard
          key={wizard.key}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          provider={editing}
          catalog={catalog}
        />
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('aiProvider.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('aiProvider.confirmDelete', { name: pendingDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
