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

export function ConfigExportImport() {
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
      
      toast.success('配置导出成功')
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setIsExporting(false)
    }
  }

  // 导入配置
  const handleImport = async () => {
    if (!importYaml.trim()) {
      toast.error('请输入要导入的配置内容')
      return
    }

    setIsImporting(true)
    setImportResult(null)
    
    try {
      const result = importConfig(importYaml)
      
      if (result.success) {
        setImportResult({
          success: true,
          message: '配置导入成功！所有设置已更新。'
        })
        toast.success('配置导入成功')
        setImportYaml('') // 清空输入框
      } else {
        setImportResult({
          success: false,
          message: result.error || '导入失败'
        })
        toast.error(result.error || '导入失败')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
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
      toast.error('文件读取失败')
    }
    reader.readAsText(file)
  }

  // 重置所有配置
  const handleReset = () => {
    if (confirm('确定要重置所有配置吗？此操作不可撤销。')) {
      resetAllConfig()
      toast.success('所有配置已重置为默认值')
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
            导出配置
          </CardTitle>
          <CardDescription>
            将当前所有设置导出为YAML文件，包括AI配置、提示词、WebDAV设置等
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
                导出中...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                导出配置文件
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
            导入配置
          </CardTitle>
          <CardDescription>
            从YAML文件或文本内容导入配置，将覆盖当前所有设置
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 文件上传 */}
          <div>
            <Label htmlFor="config-file">选择配置文件</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleFileImport}
              className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-secondary file:text-secondary-foreground hover:file:bg-accent cursor-pointer"
            />
          </div>

          {/* 或者手动输入 */}
          <div>
            <Label htmlFor="yaml-input">或直接粘贴YAML内容</Label>
            <Textarea
              id="yaml-input"
              placeholder="粘贴配置文件的YAML内容..."
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
                  导入中...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  导入配置
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
              清空
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 重置配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <RefreshCw className="h-5 w-5" />
            重置配置
          </CardTitle>
          <CardDescription>
            将所有设置恢复为默认值，此操作不可撤销
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            variant="destructive"
            onClick={handleReset}
            className="w-full sm:w-auto"
          >
            重置所有配置
          </Button>
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card>
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>• <strong>导出配置</strong>：将当前所有设置保存为YAML文件，便于备份和迁移</p>
          <p>• <strong>导入配置</strong>：从文件或文本内容恢复设置，会完全覆盖当前配置</p>
          <p>• <strong>重置配置</strong>：将所有设置恢复为初始默认值</p>
          <p>• <strong>注意事项</strong>：导入前建议先导出当前配置作为备份</p>
        </CardContent>
      </Card>
    </div>
  )
}
