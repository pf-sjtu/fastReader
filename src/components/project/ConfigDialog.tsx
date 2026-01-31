import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings, ExternalLink, Info, Play, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { PromptEditor } from './PromptEditor'
import { WebDAVConfig } from './WebDAVConfig'
import { AIProviderConfig } from './AIProviderConfig'
import { ConfigExportImport } from '../ConfigExportImport'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useConfigStore, useAIConfig, useProcessingOptions, useAIServiceOptions } from '../../stores/configStore'
import type { SupportedLanguage } from '../../services/prompts/utils'
import { chapterPreviewService } from '../../services/chapterPreviewService'
import { AIService } from '../../services/aiService'

interface ConfigDialogProps {
  processing: boolean
  file: File | null
}

export function ConfigDialog({ processing, file }: ConfigDialogProps) {
  const { t } = useTranslation()
  // 使用zustand store管理配置
  const aiConfig = useAIConfig()
  const processingOptions = useProcessingOptions()
  const aiServiceOptions = useAIServiceOptions()
  
  const [previewChapters, setPreviewChapters] = useState<{ title: string; preview: string }[]>([])
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  
  // 测试状态
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isTestingProxy, setIsTestingProxy] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{ success: boolean; message: string; details?: any } | null>(null)

  const {
    setAiProvider,
    setApiKey,
    setApiUrl,
    setModel,
    setTemperature,
    setProxyUrl,
    setProxyEnabled,
    setProcessingMode,
    setBookType,
    setUseSmartDetection,
    setSkipNonEssentialChapters,
    setMaxSubChapterDepth,
    setOutputLanguage,
    setChapterNamingMode,
    setEnableNotification,
    setChapterDetectionMode,
    setEpubTocDepth,
    setMaxRetries,
    setBaseRetryDelay
  } = useConfigStore()

  // 从store中解构状态值
  const { provider: aiProvider, apiKey, apiUrl, model, temperature } = aiConfig
  const { 
    processingMode, 
    bookType, 
    useSmartDetection, 
    skipNonEssentialChapters, 
    outputLanguage,
    chapterNamingMode,
    enableNotification,
    chapterDetectionMode,
    epubTocDepth
  } = processingOptions

  // 从AI服务选项中解构状态值
  const { maxRetries, baseRetryDelay } = aiServiceOptions

  // 测试 AI 连接
  const testAIConnection = async () => {
    if (!aiConfig.apiKey) {
      setConnectionTestResult({
        success: false,
        message: t('config.connection.enterApiKeyFirst')
      })
      return
    }
    
    setIsTestingConnection(true)
    setConnectionTestResult(null)
    
    try {
      const aiService = new AIService(aiConfig, undefined, {
        ...aiServiceOptions
      })
      const result = await aiService.testConnection()
      
      setConnectionTestResult({
        success: result,
        message: result ? t('config.connection.aiSuccess') : t('config.connection.aiFailed')
      })
      
      console.log('AI 连接测试详细结果:', {
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiUrl: aiConfig.apiUrl,
        proxyEnabled: aiConfig.proxyEnabled,
        proxyUrl: aiConfig.proxyUrl,
        success: result
      })
    } catch (error) {
      setConnectionTestResult({
        success: false,
        message: t('config.connection.testFailed', { error: error instanceof Error ? error.message : t('config.connection.unknownError') })
      })
      
      console.error('AI 连接测试失败:', error)
    } finally {
      setIsTestingConnection(false)
    }
  }
  
  // 测试代理连接
  const testProxyConnection = async () => {
    if (!aiConfig.proxyEnabled || !aiConfig.proxyUrl) {
      setProxyTestResult({
        success: false,
        message: t('config.connection.enterProxyFirst')
      })
      return
    }
    
    setIsTestingProxy(true)
    setProxyTestResult(null)
    
    try {
      const aiService = new AIService(aiConfig, undefined, {
        ...aiServiceOptions
      })
      const result = await aiService.testProxyConnection()
      
      setProxyTestResult(result)
      
      console.log('代理测试详细结果:', {
        proxyUrl: aiConfig.proxyUrl,
        ...result
      })
    } catch (error) {
      setProxyTestResult({
        success: false,
        message: t('config.connection.proxyTestFailed', { error: error instanceof Error ? error.message : t('config.connection.unknownError') })
      })
      
      console.error('代理测试失败:', error)
    } finally {
      setIsTestingProxy(false)
    }
  }

  // 章节预览函数
  const loadChapterPreview = async () => {
    if (!file) {
      setPreviewChapters([])
      return
    }

    setIsPreviewLoading(true)
    try {
      const chapters = await chapterPreviewService.previewChapters(
        file,
        chapterDetectionMode,
        epubTocDepth || 1,
        chapterNamingMode,
        20 // 最多预览20个章节
      )
      setPreviewChapters(chapters)
    } catch (error) {
      console.error('加载章节预览失败:', error)
      setPreviewChapters([])
    } finally {
      setIsPreviewLoading(false)
    }
  }

  // 当章节识别模式或文件改变时，重新加载预览
  useEffect(() => {
    loadChapterPreview()
  }, [file, chapterDetectionMode, epubTocDepth, chapterNamingMode])

  const providerSettings = {
    gemini: {
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: t('config.enterGeminiApiKey'),
      modelPlaceholder: t('config.geminiModelPlaceholder'),
      apiUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
      url: 'https://ai.google.dev/',
    },
    openai: {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: t('config.enterApiToken'),
      apiUrlPlaceholder: 'https://api.openai.com/v1',
      modelPlaceholder: t('config.modelPlaceholder'),
      url: 'https://platform.openai.com/',
    },
    ollama: {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: 'API Token',
      apiUrlPlaceholder: 'http://localhost:11434',
      modelPlaceholder: 'llama2, mistral, codellama...',
      url: 'https://ollama.com/',
    },
    '302.ai': {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: t('config.enterApiToken'),
      apiUrlPlaceholder: 'https://api.302.ai/v1',
      modelPlaceholder: t('config.modelPlaceholder'),
      url: 'https://share.302.ai/BJ7iSL',
    },
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={processing}
          className="flex items-center gap-1"
        >
          <Settings className="h-3.5 w-3.5" />
          {t('config.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[85vh] w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-wrap break-words">
            <Settings className="h-4 w-4 flex-shrink-0" />
            {t('config.aiServiceConfig')}
          </DialogTitle>
          <DialogDescription className="text-wrap break-words">
            {t('config.description')}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <Tabs defaultValue="ai-config" className="w-full">
            <TabsList className="flex flex-wrap w-full h-auto gap-1 p-1">
              <TabsTrigger value="ai-config" className="flex-1 min-w-fit">{t('config.aiServiceConfig')}</TabsTrigger>
              <TabsTrigger value="ai-providers" className="flex-1 min-w-fit">AI服务商</TabsTrigger>
              <TabsTrigger value="prompts" className="flex-1 min-w-fit">{t('promptEditor.title')}</TabsTrigger>
              <TabsTrigger value="webdav" className="flex-1 min-w-fit">WebDAV配置</TabsTrigger>
              <TabsTrigger value="export-import" className="flex-1 min-w-fit">导出导入</TabsTrigger>
            </TabsList>

            <TabsContent value="ai-config" className="space-y-3 mt-3">
              {/* AI 服务配置 */}
              <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border dark:border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Settings className="h-3 w-3" />
                    <Label className="text-xs font-medium">{t('config.aiServiceConfig')}</Label>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testAIConnection}
                    disabled={isTestingConnection || processing || !apiKey}
                    className="flex items-center gap-1 h-6 text-xs"
                  >
                    {isTestingConnection ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    测试连接
                  </Button>
                </div>
                
                {/* 连接测试结果显示 */}
                {connectionTestResult && (
                  <div className={`flex items-center gap-2 p-2 rounded-md text-xs ${
                    connectionTestResult.success 
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' 
                      : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                  }`}>
                    {connectionTestResult.success ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    {connectionTestResult.message}
                  </div>
                )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="ai-provider">{t('config.aiProvider')}</Label>
                  <div className="flex flex-col items-start gap-2">
                    <Select
                      value={aiProvider}
                      onValueChange={(value: 'gemini' | 'openai' | 'ollama' | '302.ai') => {
                        setAiProvider(value)
                        if (value === '302.ai') {
                          setApiUrl('https://api.302.ai/v1')
                        }
                      }}
                      disabled={processing}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('config.selectAiProvider')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini">Google Gemini</SelectItem>
                        <SelectItem value="openai">{t('config.openaiCompatible')}</SelectItem>
                        <SelectItem value="ollama">Ollama</SelectItem>
                        <SelectItem value="302.ai">302.AI</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="link" className="p-0 h-auto text-xs shrink-0" asChild>
                      <a href={providerSettings[aiProvider].url} target="_blank" rel="noopener noreferrer">
                        {t('config.visitSite')}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 min-w-0">
                  <Label htmlFor="apikey">
                    {providerSettings[aiProvider].apiKeyLabel}
                  </Label>
                  <Input
                    id="apikey"
                    type="password"
                    placeholder={providerSettings[aiProvider].apiKeyPlaceholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={processing}
                    className="w-full"
                  />
                </div>
              </div>

              {(aiProvider === 'openai' || aiProvider === 'ollama' || aiProvider === '302.ai') && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="api-url" className="text-wrap">{t('config.apiUrl')}</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-4 w-4 text-gray-500 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">
                                {aiProvider === 'gemini' && t('config.geminiApiUrlDescription')}
                                {aiProvider === 'openai' && t('config.openaiApiUrlDescription')}
                                {aiProvider === 'ollama' && t('config.ollamaApiUrlDescription')}
                                {aiProvider === '302.ai' && t('config.ai302ApiUrlDescription')}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        id="api-url"
                        type="url"
                        placeholder={providerSettings[aiProvider].apiUrlPlaceholder}
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        disabled={processing || aiProvider === '302.ai'}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2 min-w-0">
                      <Label htmlFor="model" className="text-wrap">{t('config.modelName')}</Label>
                      <Input
                        id="model"
                        type="text"
                        placeholder={providerSettings[aiProvider].modelPlaceholder}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={processing}
                        className="w-full"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openai-temperature">{t('config.temperature')}</Label>
                    <Input
                      id="openai-temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="0.7"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                      disabled={processing}
                    />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t('config.temperatureDescription')}
                    </p>
                  </div>
                </>
              )}

              {aiProvider === 'gemini' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="gemini-api-url" className="text-wrap">{t('config.apiUrl')}</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-gray-500 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              {t('config.geminiApiUrlDescription')}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="gemini-api-url"
                      type="url"
                      placeholder={providerSettings.gemini.apiUrlPlaceholder}
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      disabled={processing}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <Label htmlFor="gemini-model" className="text-wrap">{t('config.modelName')}</Label>
                    <Input
                      id="gemini-model"
                      type="text"
                      placeholder={providerSettings.gemini.modelPlaceholder}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={processing}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <Label htmlFor="gemini-temperature" className="text-wrap">{t('config.temperature')}</Label>
                    <Input
                      id="gemini-temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="0.7"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.7)}
                      disabled={processing}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t('config.temperatureDescription')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 代理设置 */}
            <div className="space-y-4 p-4 bg-orange-50 dark:bg-orange-950/50 rounded-lg border dark:border-orange-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <Label className="text-sm font-medium">{t('config.proxySettings')}</Label>
                </div>
                {aiConfig.proxyEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testProxyConnection}
                    disabled={isTestingProxy || processing || !aiConfig.proxyUrl}
                    className="flex items-center gap-1"
                  >
                    {isTestingProxy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    测试代理
                  </Button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="proxy-enabled"
                  checked={aiConfig.proxyEnabled || false}
                  onCheckedChange={setProxyEnabled}
                  disabled={processing}
                />
                <Label htmlFor="proxy-enabled" className="text-sm">
                  {t('config.enableProxy')}
                </Label>
              </div>

              {/* 浏览器环境代理提示 */}
              <div className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium mb-1">浏览器环境代理说明</div>
                    <div className="opacity-90">
                      当前在浏览器中运行，代理功能受限。如需使用代理，请配置浏览器扩展或系统级代理。
                    </div>
                  </div>
                </div>
              </div>

              {aiConfig.proxyEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="proxy-url">{t('config.proxyUrl')}</Label>
                  <Input
                    id="proxy-url"
                    type="url"
                    placeholder="http://127.0.0.1:10808"
                    value={aiConfig.proxyUrl || ''}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    disabled={processing}
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('config.proxyUrlDescription')}
                  </p>
                  
                  {/* 代理测试结果显示 */}
                  {proxyTestResult && (
                    <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                      proxyTestResult.success 
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' 
                        : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                      {proxyTestResult.success ? (
                        <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="space-y-2">
                        <div>{proxyTestResult.message}</div>
                        
                        {/* 浏览器环境特殊提示 */}
                        {proxyTestResult.message === '浏览器环境不支持代理功能' && (
                          <div className="space-y-2 text-xs opacity-90">
                            <div>
                              💡 <strong>原因：</strong>浏览器出于安全考虑无法直接使用系统代理。
                            </div>
                            <div>
                              🛠️ <strong>解决方案：</strong>
                            </div>
                            <ul className="ml-4 space-y-1 list-disc">
                              <li>安装浏览器代理扩展（如 SwitchyOmega）</li>
                              <li>在操作系统中配置全局代理设置</li>
                              <li>或在本地开发环境中使用此应用</li>
                            </ul>
                            <div>
                              📖 <a 
                                href="/docs/浏览器代理解决方案.md" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="underline hover:no-underline flex items-center gap-1"
                              >
                                查看详细解决方案 <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        )}
                        
                        {/* 其他错误信息 */}
                        {proxyTestResult.details?.proxyIP && (
                          <div className="text-xs opacity-75">代理IP: {proxyTestResult.details.proxyIP}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 流量限制配置 */}
            <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-950/50 rounded-lg border dark:border-blue-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <Label className="text-sm font-medium">AI流量限制配置</Label>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-gray-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        配置API流量限制时的重试策略，包括重试次数和等待时间
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max-retries" className="text-sm font-medium">
                    最大重试次数
                  </Label>
                  <Input
                    id="max-retries"
                    type="number"
                    min="0"
                    max="10"
                    placeholder="3"
                    value={maxRetries || 3}
                    onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
                    disabled={processing}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    当API返回流量限制错误时的最大重试次数，默认3次
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="base-retry-delay" className="text-sm font-medium">
                    重试等待时间（秒）
                  </Label>
                  <Input
                    id="base-retry-delay"
                    type="number"
                    min="1"
                    max="300"
                    placeholder="60"
                    value={(baseRetryDelay || 60000) / 1000}
                    onChange={(e) => setBaseRetryDelay((parseInt(e.target.value) || 60) * 1000)}
                    disabled={processing}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    流量限制时的等待时间，默认60秒（测试环境可设置较短时间）
                  </p>
                </div>
              </div>

              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-md border border-blue-200 dark:border-blue-700">
                <div className="flex items-start gap-2 text-xs text-blue-700 dark:text-blue-400">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <div className="font-medium">流量限制重试机制说明</div>
                    <div className="opacity-90">
                      • 自动识别429状态码和token_quota_exceeded等错误<br/>
                      • 支持智能等待时间调整<br/>
                      • 详细的重试日志记录<br/>
                      • 配置更改立即生效，无需重启应用
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg border dark:border-indigo-800">
              <div className="space-y-2">
                <Label htmlFor="output-language" className="text-sm font-medium">
                  {t('config.outputLanguage')}
                </Label>
                <Select value={outputLanguage} onValueChange={(value: SupportedLanguage) => setOutputLanguage(value)} disabled={processing}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('config.selectOutputLanguage')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('config.outputLanguageAuto')}</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                    <SelectItem value="ja">日本語</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="ru">Русский</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-600">
                  {t('config.outputLanguageDescription')}
                </p>
              </div>
            </div>

            <div className="p-3 bg-purple-50 dark:bg-purple-950/50 rounded-lg border dark:border-purple-800">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="processing-mode" className="text-sm font-medium">
                    {t('config.processingMode')}
                  </Label>
                  <Select value={processingMode} onValueChange={(value: 'summary' | 'mindmap' | 'combined-mindmap') => setProcessingMode(value)} disabled={processing}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('config.selectProcessingMode')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="summary">{t('config.summaryMode')}</SelectItem>
                      <SelectItem value="mindmap">{t('config.mindmapMode')}</SelectItem>
                      <SelectItem value="combined-mindmap">{t('config.combinedMindmapMode')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600">
                    {t('config.processingModeDescription')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="book-type" className="text-sm font-medium">
                    {t('config.bookType')}
                  </Label>
                  <Select value={bookType} onValueChange={(value: 'fiction' | 'non-fiction') => setBookType(value)} disabled={processing}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('config.selectBookType')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="non-fiction">{t('config.socialType')}</SelectItem>
                      <SelectItem value="fiction">{t('config.novelType')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600">
                    {t('config.bookTypeDescription', { type: processingMode === 'summary' ? t('config.summary') : t('config.mindmap') })}
                  </p>
                </div>
              </div>
            </div>

            {/* 章节和通知设置 */}
            <div className="space-y-4 p-4 bg-green-50 dark:bg-green-950/50 rounded-lg border dark:border-green-800">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="h-4 w-4" />
                <Label className="text-sm font-medium">{t('config.chapterAndNotificationSettings')}</Label>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2 min-w-0 w-full">
                  <Label htmlFor="chapter-naming-mode" className="text-wrap text-sm font-medium">
                    {t('config.chapterNamingMode')}
                  </Label>
                  <Select value={chapterNamingMode || 'auto'} onValueChange={(value: 'auto' | 'numbered') => setChapterNamingMode(value)} disabled={processing}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('config.selectChapterNamingMode')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t('config.autoNaming')}</SelectItem>
                      <SelectItem value="numbered">{t('config.numberedNaming')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('config.chapterNamingModeDescription')}
                  </p>
                </div>

                <div className="space-y-2 min-w-0 w-full">
                  <Label className="text-wrap text-sm font-medium">
                    {t('config.notificationSettings')}
                  </Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch
                      id="enable-notification"
                      checked={enableNotification}
                      onCheckedChange={setEnableNotification}
                      disabled={processing}
                    />
                    <Label htmlFor="enable-notification" className="text-sm">
                      {t('config.enableNotification')}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('config.notificationDescription')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/50 rounded-lg border dark:border-green-800">
              <div className="space-y-1">
                <Label htmlFor="skip-non-essential" className="text-sm font-medium">
                  {t('config.skipIrrelevantChapters')}
                </Label>
                <p className="text-xs text-gray-600">
                  {t('config.skipIrrelevantChaptersDescription')}
                </p>
              </div>
              <Switch
                id="skip-non-essential"
                checked={skipNonEssentialChapters}
                onCheckedChange={setSkipNonEssentialChapters}
                disabled={processing}
              />
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-lg border dark:border-amber-800">
              <div className="space-y-2">
                <Label htmlFor="max-sub-chapter-depth" className="text-sm font-medium">
                  {t('config.recursionDepth')}
                </Label>
                <Select
                  value={processingOptions.maxSubChapterDepth?.toString()}
                  onValueChange={(value) => useConfigStore.getState().setMaxSubChapterDepth(parseInt(value))}
                  disabled={processing}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('config.selectRecursionDepth')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('config.noRecursion')}</SelectItem>
                    <SelectItem value="1">{t('config.recursion1Layer')}</SelectItem>
                    <SelectItem value="2">{t('config.recursion2Layers')}</SelectItem>
                    <SelectItem value="3">{t('config.recursion3Layers')}</SelectItem>
                    <SelectItem value="4">{t('config.recursion4Layers')}</SelectItem>
                    <SelectItem value="5">{t('config.recursion5Layers')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-600">
                  {t('config.recursionDepthDescription')}
                </p>
              </div>
            </div>

            {/* 章节识别模式设置 */}
            <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-950/50 rounded-lg border dark:border-blue-800">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="h-4 w-4" />
                <Label className="text-sm font-medium">{t('config.chapterDetectionMode')}</Label>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {t('config.selectDetectionMode')}
                  </Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="normal-mode"
                        name="chapter-detection-mode"
                        value="normal"
                        checked={chapterDetectionMode === 'normal'}
                        onChange={(e) => setChapterDetectionMode(e.target.value as 'normal' | 'smart' | 'epub-toc')}
                        disabled={processing}
                      />
                      <Label htmlFor="normal-mode" className="text-sm font-normal">
                        {t('config.normalMode')}
                      </Label>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 ml-6">
                      {t('config.normalModeDescription')}
                    </p>

                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="smart-mode"
                        name="chapter-detection-mode"
                        value="smart"
                        checked={chapterDetectionMode === 'smart'}
                        onChange={(e) => setChapterDetectionMode(e.target.value as 'normal' | 'smart' | 'epub-toc')}
                        disabled={processing}
                      />
                      <Label htmlFor="smart-mode" className="text-sm font-normal">
                        {t('config.smartDetectionMode')}
                      </Label>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 ml-6">
                      {t('config.smartDetectionModeDescription')}
                    </p>

                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="epub-toc-mode"
                        name="chapter-detection-mode"
                        value="epub-toc"
                        checked={chapterDetectionMode === 'epub-toc'}
                        onChange={(e) => setChapterDetectionMode(e.target.value as 'normal' | 'smart' | 'epub-toc')}
                        disabled={processing}
                      />
                      <Label htmlFor="epub-toc-mode" className="text-sm font-normal">
                        {t('config.epubTocMode')}
                      </Label>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 ml-6">
                      {t('config.epubTocModeDescription')}
                    </p>
                  </div>
                </div>

                {chapterDetectionMode === 'epub-toc' && (
                  <div className="space-y-2">
                    <Label htmlFor="epub-toc-depth" className="text-sm font-medium">
                      {t('config.epubTocDepth')}
                    </Label>
                    <Select value={(epubTocDepth || 1).toString()} onValueChange={(value) => setEpubTocDepth(parseInt(value))} disabled={processing}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('config.selectEpubTocDepth')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t('config.epubTocDepth1')}</SelectItem>
                        <SelectItem value="2">{t('config.epubTocDepth2')}</SelectItem>
                        <SelectItem value="3">{t('config.epubTocDepth3')}</SelectItem>
                        <SelectItem value="4">{t('config.epubTocDepth4')}</SelectItem>
                        <SelectItem value="5">{t('config.epubTocDepth5')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t('config.epubTocDepthDescription')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 章节预览 */}
            {file && (
              <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Settings className="h-4 w-4" />
                  <Label className="text-sm font-medium">
                    {t('config.chapterPreview')}
                    {isPreviewLoading && <Loader2 className="h-3 w-3 animate-spin ml-2" />}
                  </Label>
                </div>

                {previewChapters.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto overscroll-contain">
                    {previewChapters.map((chapter, index) => (
                      <div key={`${chapter.title}-${index}`} className="flex items-start gap-2 p-2 bg-white dark:bg-gray-900 rounded border dark:border-gray-600">
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono shrink-0 w-8">
                          {(index + 1).toString().padStart(2, '0')}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {chapter.title}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {chapter.preview}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !isPreviewLoading ? (
                  <div className="text-sm text-gray-600 dark:text-gray-400 text-center py-4">
                    {t('config.noChaptersFound')}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 dark:text-gray-400 text-center py-4">
                    {t('config.loadingPreview')}
                  </div>
                )}
              </div>
            )}
            </TabsContent>

            <TabsContent value="ai-providers" className="mt-4">
              <AIProviderConfig />
            </TabsContent>

            <TabsContent value="prompts" className="mt-4">
              <PromptEditor />
            </TabsContent>

            <TabsContent value="webdav" className="mt-4">
              <WebDAVConfig />
            </TabsContent>

            <TabsContent value="export-import" className="mt-4">
              <ConfigExportImport />
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export default ConfigDialog