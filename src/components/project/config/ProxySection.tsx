// 代理设置分区。浏览器无法直接使用 HTTP 代理（AIService 也未提供代理探测），「测试代理」只给出说明
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Info, Play, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useConfigStore, useAIConfig } from '../../../stores/configStore'

/** 结构化测试结果：不再用文案字符串比较判断是否展示浏览器说明 */
type ProxyTestResult = 'missingProxy' | 'browserUnsupported'

export function ProxySection({ processing }: { processing: boolean }) {
  const { t } = useTranslation()
  const { proxyEnabled, proxyUrl } = useAIConfig()
  const setProxyUrl = useConfigStore((s) => s.setProxyUrl)
  const setProxyEnabled = useConfigStore((s) => s.setProxyEnabled)
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null)

  const testProxy = () => {
    setTestResult(!proxyEnabled || !proxyUrl ? 'missingProxy' : 'browserUnsupported')
  }

  return (
    <div className="space-y-4 p-4 bg-orange-50 dark:bg-orange-950/50 rounded-lg border dark:border-orange-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <Label className="text-sm font-medium">{t('config.proxySettings')}</Label>
        </div>
        {proxyEnabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={testProxy}
            disabled={processing || !proxyUrl}
            className="flex items-center gap-1"
          >
            <Play className="h-3 w-3" />
            {t('config.proxy.test')}
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <Switch id="proxy-enabled" checked={proxyEnabled || false} onCheckedChange={setProxyEnabled} disabled={processing} />
        <Label htmlFor="proxy-enabled" className="text-sm">
          {t('config.enableProxy')}
        </Label>
      </div>

      <div className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium mb-1">{t('config.proxy.browserNoteTitle')}</div>
            <div className="opacity-90">{t('config.proxy.browserNote')}</div>
          </div>
        </div>
      </div>

      {proxyEnabled && (
        <div className="space-y-2">
          <Label htmlFor="proxy-url">{t('config.proxyUrl')}</Label>
          <Input
            id="proxy-url"
            type="url"
            placeholder="http://127.0.0.1:10808"
            value={proxyUrl || ''}
            onChange={(e) => setProxyUrl(e.target.value)}
            disabled={processing}
          />
          <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.proxyUrlDescription')}</p>

          {testResult && (
            <div
              role="status"
              className="flex items-start gap-2 p-3 rounded-md text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
            >
              <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <div>
                  {testResult === 'missingProxy'
                    ? t('config.connection.enterProxyFirst')
                    : t('config.proxy.browserUnsupported')}
                </div>
                {testResult === 'browserUnsupported' && (
                  <div className="space-y-2 text-xs opacity-90">
                    <div>
                      <strong>{t('config.proxy.reasonLabel')}</strong>
                      {t('config.proxy.reason')}
                    </div>
                    <div>
                      <strong>{t('config.proxy.solutionsLabel')}</strong>
                    </div>
                    <ul className="ml-4 space-y-1 list-disc">
                      <li>{t('config.proxy.solutionExtension')}</li>
                      <li>{t('config.proxy.solutionSystem')}</li>
                      <li>{t('config.proxy.solutionLocal')}</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
