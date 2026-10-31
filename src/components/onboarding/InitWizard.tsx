// 初始化向导：服务端还没有任何共享状态时，让第一位用户决定怎么开始
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, HardDriveDownload, Sparkles, Loader2, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useConfigStore } from '@/stores/configStore'
import {
  buildImportPlanFromLocal,
  hasLocalLegacyConfig,
  readLocalLegacyConfig,
} from '@/stores/legacyMigration'
import { ConfigExportService, type ImportPlan, type ImportPreview } from '@/services/configExportService'

type Step = 'choose' | 'file' | 'preview'

interface InitWizardProps {
  /** 完成后回调（调用方负责重新拉取共享状态） */
  onDone: () => void | Promise<void>
}

export function InitWizard({ onDone }: InitWizardProps) {
  const { t } = useTranslation()
  const previewImport = useConfigStore((s) => s.previewImport)
  const applyImportPlan = useConfigStore((s) => s.applyImportPlan)
  const reloadSharedState = useConfigStore((s) => s.reloadSharedState)
  const initializeSharedState = useConfigStore((s) => s.initializeSharedState)

  const [step, setStep] = useState<Step>('choose')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const localAvailable = useMemo(() => hasLocalLegacyConfig(), [])

  /**
   * 写入基线 → 重新拉取 → 交给 App。
   *
   * 必须先写：服务端为空时 `loadAll()` 会报告 `initialized:false`，App 会把用户又送回向导。
   * `force: true` 是必需的：此时本地值恰好等于默认值（与 base 相同），普通 flush 会短路。
   */
  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      await initializeSharedState()
      await reloadSharedState()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleImportLocal = () => {
    const snapshot = readLocalLegacyConfig()
    if (!snapshot) {
      setError(t('init.localMissing'))
      return
    }
    const localPlan = buildImportPlanFromLocal(snapshot)
    setPlan(localPlan)
    setPreview(ConfigExportService.preview(localPlan))
    setStep('preview')
  }

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const result = previewImport(text)
      if (!result.plan || !result.preview) {
        setError(result.error ?? t('init.parseFailed'))
        return
      }
      setPlan(result.plan)
      setPreview(result.preview)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('init.parseFailed'))
    }
  }

  const handleApply = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const result = applyImportPlan(plan)
      if (!result.success) {
        setError(result.error ?? t('init.applyFailed'))
        return
      }
      await finish()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('init.title')}
          </CardTitle>
          <CardDescription>{t('init.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setStep('file')}
                className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2 font-medium">
                  <FileUp className="h-4 w-4 text-primary" />
                  {t('init.importFile')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t('init.importFileHint')}</p>
              </button>

              <button
                type="button"
                disabled={!localAvailable}
                onClick={handleImportLocal}
                className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2 font-medium">
                  <HardDriveDownload className="h-4 w-4 text-primary" />
                  {t('init.importLocal')}
                  {localAvailable && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      {t('init.detected')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {localAvailable ? t('init.importLocalHint') : t('init.localMissing')}
                </p>
              </button>

              <Separator />

              <Button variant="outline" className="w-full" onClick={() => void finish()} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('init.startEmpty')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground">{t('init.startEmptyHint')}</p>
            </div>
          )}

          {step === 'file' && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">{t('init.chooseFile')}</span>
                <Input
                  type="file"
                  accept=".yaml,.yml,text/yaml"
                  className="mt-2 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleFile(file)
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">{t('init.chooseFileHint')}</p>
              <Button variant="ghost" onClick={() => setStep('choose')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('common.back')}
              </Button>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t('init.previewTitle')}</span>
                  <Badge variant="secondary">v{preview.version}</Badge>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    {t('init.previewProviders', {
                      providers: preview.providerCount,
                      models: preview.modelCount,
                    })}
                  </li>
                  {preview.providers.map((provider) => (
                    <li key={`${provider.name}-${provider.baseUrl}`} className="truncate">
                      • {provider.name} — {provider.models} {t('init.modelsUnit')}
                      {provider.hasKey ? ` · ${t('init.hasKey')}` : ''}
                    </li>
                  ))}
                  <li>
                    {preview.promptOverrideKeys.length > 0
                      ? t('init.previewPrompts', { count: preview.promptOverrideKeys.length })
                      : t('init.previewPromptsNone')}
                  </li>
                  {preview.webdav.serverUrl && (
                    <li>
                      {t('init.previewWebdav', {
                        server: preview.webdav.serverUrl,
                        password: preview.webdav.hasPassword ? t('init.hasPassword') : t('init.noPassword'),
                      })}
                    </li>
                  )}
                  {preview.notes.map((note) => (
                    <li key={note} className="text-warning">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep('choose')} disabled={busy}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('common.back')}
                </Button>
                <Button className="flex-1" onClick={handleApply} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('init.apply')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
