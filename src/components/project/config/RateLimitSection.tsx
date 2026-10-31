// AI 流量限制（重试策略）分区
import { useTranslation } from 'react-i18next'
import { Settings, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { parseNonNegativeInt } from './numberInputs'
import { useConfigStore, useAIServiceOptions } from '../../../stores/configStore'

const DEFAULT_RETRIES = 3
const DEFAULT_DELAY_SEC = 60


export function RateLimitSection({ processing }: { processing: boolean }) {
  const { t } = useTranslation()
  const { maxRetries, baseRetryDelay } = useAIServiceOptions()
  const setMaxRetries = useConfigStore((s) => s.setMaxRetries)
  const setBaseRetryDelay = useConfigStore((s) => s.setBaseRetryDelay)

  return (
    <div className="space-y-4 p-4 bg-muted rounded-lg border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <Label className="text-sm font-medium">{t('config.rateLimit.title')}</Label>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">{t('config.rateLimit.tooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="max-retries" className="text-sm font-medium">
            {t('config.rateLimit.maxRetries')}
          </Label>
          <Input
            id="max-retries"
            type="number"
            min="0"
            max="10"
            placeholder={String(DEFAULT_RETRIES)}
            value={maxRetries ?? DEFAULT_RETRIES}
            onChange={(e) => setMaxRetries(parseNonNegativeInt(e.target.value, DEFAULT_RETRIES))}
            disabled={processing}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">{t('config.rateLimit.maxRetriesHint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="base-retry-delay" className="text-sm font-medium">
            {t('config.rateLimit.retryDelay')}
          </Label>
          <Input
            id="base-retry-delay"
            type="number"
            min="1"
            max="300"
            placeholder={String(DEFAULT_DELAY_SEC)}
            value={(baseRetryDelay || DEFAULT_DELAY_SEC * 1000) / 1000}
            onChange={(e) =>
              setBaseRetryDelay((parseNonNegativeInt(e.target.value, DEFAULT_DELAY_SEC) || DEFAULT_DELAY_SEC) * 1000)
            }
            disabled={processing}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">{t('config.rateLimit.retryDelayHint')}</p>
        </div>
      </div>

      <div className="p-3 bg-muted rounded-md border">
        <div className="flex items-start gap-2 text-xs text-primary">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">{t('config.rateLimit.mechanismTitle')}</div>
            <ul className="opacity-90 list-disc ml-4">
              <li>{t('config.rateLimit.mechanism1')}</li>
              <li>{t('config.rateLimit.mechanism2')}</li>
              <li>{t('config.rateLimit.mechanism3')}</li>
              <li>{t('config.rateLimit.mechanism4')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
