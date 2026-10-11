import React, { useRef } from 'react'
import { useConfigStore } from '../stores/configStore'
import { ConfigExportService } from '../services/configExportService'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { 
  Download, 
  Upload, 
  FileText, 
  AlertCircle, 
  CheckCircle,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

export function ConfigExportImport() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importYaml, setImportYaml] = React.useState('')
  const [isImporting, setIsImporting] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [importResult, setImportResult] = React.useState<{
    success: boolean
    message: string
  } | null>(null)

  const exportConfig = useConfigStore((state) => state.exportConfig)
  const importConfig = useConfigStore((state) => state.importConfig)
  const resetAllConfig = useConfigStore((state) => state.resetAllConfig)

  // 导出配置
  const handleExport = async () => {
    setIsExporting(true)
    try {
      const yamlContent = exportConfig()
      
      // 创建下载链接
      const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = ConfigExportService.generateFileName()
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      toast.success(t('configIO.exportSuccess'))
    } catch (error) {
      toast.error(t('configIO.exportFailed', { error: error instanceof Error ? error.message : t('common.unknownError') }))
    } finally {
      setIsExporting(false)
    }
  }

  // 导入配置
  const handleImport = async () => {
    if (!importYaml.trim()) {
      toast.error(t('configIO.emptyImport'))
      return
    }

    setIsImporting(true)
    setImportResult(null)
    
    try {
      const result = importConfig(importYaml)
      
      if (result.success) {
        setImportResult({
          success: true,
          message: t('configIO.importSuccessDetail')
        })
        toast.success(t('configIO.importSuccess'))
        setImportYaml('') // 清空输入框
      } else {
        setImportResult({
          success: false,
          message: result.error || t('configIO.importFailed')
        })
        toast.error(result.error || t('configIO.importFailed'))
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError')
      setImportResult({
        success: false,
        message: errorMessage
      })
      toast.error(errorMessage)
    } finally {
      setIsImporting(false)
    }
  }

  // 文件选择导入
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setImportYaml(content)
    }
    reader.onerror = () => {
      toast.error(t('configIO.readFailed'))
    }
    reader.readAsText(file)
  }

  // 重置所有配置
  const handleReset = () => {
    if (confirm(t('configIO.confirmReset'))) {
      resetAllConfig()
      toast.success(t('configIO.resetDone'))
      setImportResult(null)
      setImportYaml('')
    }
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
          <CardDescription>
            {t('configIO.exportDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleExport}
            disabled={isExporting}
            className="w-full sm:w-auto"
          >
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
          <CardDescription>
            {t('configIO.importDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 文件上传 */}
          <div>
            <Label htmlFor="config-file">{t('configIO.chooseFile')}</Label>
            <input
              id="config-file"
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleFileImport}
              className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-secondary file:text-secondary-foreground hover:file:bg-accent cursor-pointer"
            />
          </div>

          {/* 或者手动输入 */}
          <div>
            <Label htmlFor="yaml-input">{t('configIO.pasteLabel')}</Label>
            <Textarea
              id="yaml-input"
              placeholder={t('configIO.pastePlaceholder')}
              value={importYaml}
              onChange={(e) => setImportYaml(e.target.value)}
              className="mt-1 min-h-[200px] font-mono text-sm"
            />
          </div>

          {/* 导入结果 */}
          {importResult && (
            <Alert variant={importResult.success ? "default" : "destructive"}>
              {importResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>{importResult.message}</AlertDescription>
            </Alert>
          )}

          {/* 导入按钮 */}
          <div className="flex gap-2">
            <Button 
              onClick={handleImport}
              disabled={isImporting || !importYaml.trim()}
              className="flex-1"
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
              variant="outline"
              onClick={() => {
                setImportYaml('')
                setImportResult(null)
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
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
          <CardTitle className="flex items-center gap-2 text-red-600">
            <RefreshCw className="h-5 w-5" />
            {t('configIO.resetTitle')}
          </CardTitle>
          <CardDescription>
            {t('configIO.resetDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            variant="destructive"
            onClick={handleReset}
            className="w-full sm:w-auto"
          >
            {t('configIO.resetButton')}
          </Button>
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('configIO.helpTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          {(['export', 'import', 'reset', 'note'] as const).map((k) => (
            <p key={k}>
              • <strong>{t(`configIO.help.${k}Label`)}</strong>: {t(`configIO.help.${k}`)}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
