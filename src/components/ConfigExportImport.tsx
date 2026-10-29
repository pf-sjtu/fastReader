import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Download,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  KeyRound,
  Eye,
} from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { ConfigExportService, type ImportPreview } from '../services/configExportService'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

export function ConfigExportImport() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importYaml, setImportYaml] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const exportConfig = useConfigStore((state) => state.exportConfig)
  const previewImport = useConfigStore((state) => state.previewImport)
  const applyImportPlan = useConfigStore((state) => state.applyImportPlan)
  const resetAllConfig = useConfigStore((state) => state.resetAllConfig)

  const downloadYaml = (yamlContent: string) => {
    const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = ConfigExportService.generateFileName()
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      downloadYaml(exportConfig({ includeSecrets }))
      toast.success(t('configIO.exportSuccess'))
    } catch (error) {
      toast.error(
        t('configIO.exportFailed', {
          error: error instanceof Error ? error.message : t('common.unknownError'),
        })
      )
    } finally {
      setIsExporting(false)
    }
  }

  /** 解析并展示预览，用户确认后才写入 */
  const handlePreview = () => {
    if (!importYaml.trim()) {
      toast.error(t('configIO.emptyImport'))
      return
    }
    const result = previewImport(importYaml)
    if (!result.plan || !result.preview) {
      const message = result.error ?? t('configIO.importFailed')
      setImportPreview(null)
      setImportError(message)
      setImportResult({ success: false, message })
      // 表单内提示 + toast：用户在长表单底部时也能看到
      toast.error(message)
      return
    }
    setImportError(null)
    setImportPreview(result.preview)
    setImportResult(null)
  }

  const handleApply = () => {
    if (!importYaml.trim()) return
    setIsImporting(true)
    try {
      const result = previewImport(importYaml)
      if (!result.plan) {
        setImportResult({ success: false, message: result.error ?? t('configIO.importFailed') })
        return
      }
      const applied = applyImportPlan(result.plan)
      if (applied.success) {
        setImportResult({ success: true, message: t('configIO.importSuccessDetail') })
        toast.success(t('configIO.importSuccess'))
        setImportYaml('')
        setImportPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setImportResult({ success: false, message: applied.error ?? t('configIO.importFailed') })
        toast.error(applied.error ?? t('configIO.importFailed'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.unknownError')
      setImportResult({ success: false, message })
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      setImportYaml((e.target?.result as string) ?? '')
      setImportPreview(null)
      setImportResult(null)
    }
    reader.onerror = () => toast.error(t('configIO.readFailed'))
    reader.readAsText(file)
  }

  const handleReset = () => {
    resetAllConfig()
    toast.success(t('configIO.resetDone'))
    setImportResult(null)
    setImportPreview(null)
    setImportYaml('')
    setConfirmResetOpen(false)
  }

  return (
    <div className="space-y-6">
      {/* 导出配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('configIO.exportTitle')}
          </CardTitle>
          <CardDescription>{t('configIO.exportDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={includeSecrets}
              onCheckedChange={(checked) => setIncludeSecrets(checked === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5" />
                {t('configIO.includeSecrets')}
              </span>
              <span className="block text-xs text-muted-foreground">{t('configIO.includeSecretsHint')}</span>
            </span>
          </label>

          <Button onClick={handleExport} disabled={isExporting} className="w-full sm:w-auto">
            {isExporting ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('configIO.exporting')}
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                {t('configIO.exportButton')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 导入配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('configIO.importTitle')}
          </CardTitle>
          <CardDescription>{t('configIO.importDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="config-file">{t('configIO.chooseFile')}</Label>
            <input
              id="config-file"
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleFileImport}
              className="mt-1 block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-secondary file:text-secondary-foreground hover:file:bg-accent cursor-pointer"
            />
          </div>

          <div>
            <Label htmlFor="yaml-input">{t('configIO.pasteLabel')}</Label>
            <Textarea
              id="yaml-input"
              placeholder={t('configIO.pastePlaceholder')}
              value={importYaml}
              onChange={(e) => {
                setImportYaml(e.target.value)
                setImportPreview(null)
                setImportError(null)
              }}
              className="mt-1 min-h-[160px] font-mono text-sm"
            />
          </div>

          {importError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}

          {/* 导入预览：确认前不写服务端 */}
          {importPreview && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  {t('configIO.previewTitle')}
                </span>
                <Badge variant="secondary">v{importPreview.version}</Badge>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  {t('init.previewProviders', {
                    providers: importPreview.providerCount,
                    models: importPreview.modelCount,
                  })}
                </li>
                {importPreview.providers.map((provider) => (
                  <li key={`${provider.name}-${provider.baseUrl}`} className="truncate">
                    • {provider.name} — {provider.models} {t('init.modelsUnit')}
                    {provider.hasKey ? ` · ${t('init.hasKey')}` : ''}
                  </li>
                ))}
                <li>
                  {importPreview.promptOverrideKeys.length > 0
                    ? t('init.previewPrompts', { count: importPreview.promptOverrideKeys.length })
                    : t('init.previewPromptsNone')}
                </li>
                {importPreview.notes.map((note) => (
                  <li key={note} className="text-amber-600 dark:text-amber-500">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {importResult && (
            <Alert variant={importResult.success ? 'default' : 'destructive'}>
              {importResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>{importResult.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={!importYaml.trim()}
              className="flex-1 min-w-[8rem]"
            >
              <Eye className="mr-2 h-4 w-4" />
              {t('configIO.previewButton')}
            </Button>

            <Button
              onClick={handleApply}
              disabled={isImporting || !importYaml.trim() || !importPreview}
              className="flex-1 min-w-[8rem]"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('configIO.importing')}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('configIO.importButton')}
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                setImportYaml('')
                setImportPreview(null)
                setImportError(null)
                setImportResult(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              {t('configIO.clear')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 重置配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <RefreshCw className="h-5 w-5" />
            {t('configIO.resetTitle')}
          </CardTitle>
          <CardDescription>{t('configIO.resetDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmResetOpen(true)} className="w-full sm:w-auto">
            {t('configIO.resetButton')}
          </Button>
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('configIO.helpTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {(['export', 'import', 'reset', 'note'] as const).map((k) => (
            <p key={k}>
              • <strong>{t(`configIO.help.${k}Label`)}</strong>: {t(`configIO.help.${k}`)}
            </p>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('configIO.confirmReset')}</AlertDialogTitle>
            <AlertDialogDescription>{t('configIO.resetDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
