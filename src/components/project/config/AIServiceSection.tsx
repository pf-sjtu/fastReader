// AI 服务配置分区：服务商 / API Key / 地址 / 模型 / 温度 + 连接测试（即时保存到 store）
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Settings, ExternalLink, Info, Play, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { parseTemperature } from './numberInputs'
import { useConfigStore, useAIConfig, useAIServiceOptions } from '../../../stores/configStore'
import { useAIConnectionTest } from './useAIConnectionTest'

type ProviderId = 'gemini' | 'openai' | 'ollama' | '302.ai'

interface ProviderSetting {
  apiKeyLabel: string
  apiKeyPlaceholder: string
  modelPlaceholder: string
  apiUrlPlaceholder: string
  apiUrlHintKey: string
  url: string
}

const AI302_URL = 'https://api.302.ai/v1'


function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-4 w-4 text-gray-500 cursor-help" />
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function AIServiceSection({ processing }: { processing: boolean }) {
  const { t } = useTranslation()
  const aiConfig = useAIConfig()
  const aiServiceOptions = useAIServiceOptions()
  const { setAiProvider, setApiKey, setApiUrl, setModel, setTemperature } = useConfigStore(
    useShallow((s) => ({
      setAiProvider: s.setAiProvider,
      setApiKey: s.setApiKey,
      setApiUrl: s.setApiUrl,
      setModel: s.setModel,
      setTemperature: s.setTemperature,
    }))
  )
  const { isTesting, result, test } = useAIConnectionTest()
  const { provider, apiKey, apiUrl, model, temperature } = aiConfig

  const settings: Record<ProviderId, ProviderSetting> = {
    gemini: {
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: t('config.enterGeminiApiKey'),
      modelPlaceholder: t('config.geminiModelPlaceholder'),
      apiUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
      apiUrlHintKey: 'config.geminiApiUrlDescription',
      url: 'https://ai.google.dev/',
    },
    openai: {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: t('config.enterApiToken'),
      apiUrlPlaceholder: 'https://api.openai.com/v1',
      modelPlaceholder: t('config.modelPlaceholder'),
      apiUrlHintKey: 'config.openaiApiUrlDescription',
      url: 'https://platform.openai.com/',
    },
    ollama: {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: 'API Token',
      apiUrlPlaceholder: 'http://localhost:11434',
      modelPlaceholder: 'llama2, mistral, codellama...',
      apiUrlHintKey: 'config.ollamaApiUrlDescription',
      url: 'https://ollama.com/',
    },
    '302.ai': {
      apiKeyLabel: 'API Token',
      apiKeyPlaceholder: t('config.enterApiToken'),
      apiUrlPlaceholder: AI302_URL,
      modelPlaceholder: t('config.modelPlaceholder'),
      apiUrlHintKey: 'config.ai302ApiUrlDescription',
      url: 'https://share.302.ai/BJ7iSL',
    },
  }
  const current = settings[provider as ProviderId] ?? settings.gemini

  return (
    <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Settings className="h-3 w-3" />
          <Label className="text-xs font-medium">{t('config.aiServiceConfig')}</Label>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void test(aiConfig, { ...aiServiceOptions })}
          disabled={isTesting || processing || !apiKey}
          className="flex items-center gap-1 h-6 text-xs"
        >
          {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {t('config.testConnection')}
        </Button>
      </div>

      {result && (
        <div
          role="status"
          className={`flex items-center gap-2 p-2 rounded-md text-xs ${
            result.success
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {result.success ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {result.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2 min-w-0">
          <Label htmlFor="ai-provider">{t('config.aiProvider')}</Label>
          <div className="flex flex-col items-start gap-2">
            <Select
              value={provider}
              onValueChange={(value: ProviderId) => {
                setAiProvider(value)
                if (value === '302.ai') setApiUrl(AI302_URL)
              }}
              disabled={processing}
            >
              <SelectTrigger className="w-full" id="ai-provider">
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
              <a href={current.url} target="_blank" rel="noopener noreferrer">
                {t('config.visitSite')}
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="apikey">{current.apiKeyLabel}</Label>
          <Input
            id="apikey"
            type="password"
            placeholder={current.apiKeyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={processing}
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <Label htmlFor="api-url" className="text-wrap">{t('config.apiUrl')}</Label>
            <InfoTip text={t(current.apiUrlHintKey)} />
          </div>
          <Input
            id="api-url"
            type="url"
            placeholder={current.apiUrlPlaceholder}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            disabled={processing || provider === '302.ai'}
            className="w-full"
          />
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="model" className="text-wrap">{t('config.modelName')}</Label>
          <Input
            id="model"
            type="text"
            placeholder={current.modelPlaceholder}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={processing}
            className="w-full"
          />
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="ai-temperature" className="text-wrap">{t('config.temperature')}</Label>
          <Input
            id="ai-temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            placeholder="0.7"
            value={temperature}
            onChange={(e) => setTemperature(parseTemperature(e.target.value))}
            disabled={processing}
            className="w-full"
          />
          <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.temperatureDescription')}</p>
        </div>
      </div>
    </div>
  )
}
