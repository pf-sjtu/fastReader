import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Settings, ExternalLink, Info, CheckCircle, XCircle, Loader2, FolderOpen, RefreshCw, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '../../stores/configStore'
import { webdavService } from '../../services/webdavService'
import { useWebDAVClient, isWebDAVConfigComplete } from './webdav/useWebDAVClient'

const AUTO_TEST_DELAY_MS = 1000

const STATUS_ICON: Record<string, ReactNode> = {
  connected: <CheckCircle className="h-4 w-4 text-green-500" />,
  connecting: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function WebDAVConfig() {
  const { t } = useTranslation()
  const { config: webdavConfig, ensureReady, errorText } = useWebDAVClient()
  const s = useConfigStore(
    useShallow((st) => ({
      setWebDAVEnabled: st.setWebDAVEnabled,
      setWebDAVServerUrl: st.setWebDAVServerUrl,
      setWebDAVUsername: st.setWebDAVUsername,
      setWebDAVPassword: st.setWebDAVPassword,
      setWebDAVAppName: st.setWebDAVAppName,
      setWebDAVAutoSync: st.setWebDAVAutoSync,
      setWebDAVSyncPath: st.setWebDAVSyncPath,
      setWebDAVBrowsePath: st.setWebDAVBrowsePath,
      setWebDAVConnectionStatus: st.setWebDAVConnectionStatus,
      resetWebDAVConfig: st.resetWebDAVConfig,
    }))
  )
  const setStatus = s.setWebDAVConnectionStatus

  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  // 密码只在本地输入框里存在：store 里只有 { hasSecret }，绝不回显
  const [passwordDraft, setPasswordDraft] = useState('')
  // 只采纳最后一次测试的结果；记录已自动测试过的凭据，避免重复自动测试
  const testSeqRef = useRef(0)
  const autoTestedKeyRef = useRef('')

  const testConnection = useCallback(async () => {
    if (!isWebDAVConfigComplete(useConfigStore.getState().webdavConfig)) {
      setTestResult({ success: false, message: t('webdav.config.fillAll') })
      return
    }
    const seq = ++testSeqRef.current
    const done = (success: boolean, message: string) => {
      if (seq !== testSeqRef.current) return
      setStatus(success ? 'connected' : 'error')
      setTestResult({ success, message })
      setIsTesting(false)
    }
    setIsTesting(true)
    setStatus('connecting')
    setTestResult(null)
    // 用最新配置重新初始化，再探测
    const initError = await ensureReady(true)
    if (initError) return done(false, initError)
    try {
      const r = await webdavService.testConnection()
      done(r.success, r.success ? t('webdav.config.testSuccess') : r.error || t('webdav.config.testFailed'))
    } catch (err) {
      done(false, t('webdav.config.testException', { error: errorText(err) }))
    }
  }, [ensureReady, errorText, setStatus, t])

  // 启用且凭据完整时，凭据变化后防抖自动测试一次
  const { enabled, serverUrl, username, password } = webdavConfig
  const hasSecret = password?.hasSecret === true
  // 草稿参与 key：重新输入密码后也会再自动测试一次（key 只存在内存，不外传）
  const autoKey = enabled && serverUrl && username && hasSecret ? `${serverUrl}\n${username}\n${passwordDraft}` : ''
  useEffect(() => {
    if (!autoKey || autoKey === autoTestedKeyRef.current) return
    const timer = setTimeout(() => {
      autoTestedKeyRef.current = autoKey
      void testConnection()
    }, AUTO_TEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [autoKey, testConnection])

  const handlePasswordChange = (value: string) => {
    setPasswordDraft(value)
    // 留空表示保持服务端已有密码，不提交空串
    if (value) s.setWebDAVPassword(value)
  }

  const handleClearPassword = () => {
    setPasswordDraft('')
    s.setWebDAVPassword(null)
  }

  const handleReset = () => {
    setPasswordDraft('')
    s.resetWebDAVConfig()
    setTestResult(null)
    webdavService.disconnect()
  }

  const statusKey = ['connected', 'connecting', 'error'].includes(webdavConfig.connectionStatus)
    ? webdavConfig.connectionStatus
    : 'disconnected'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="webdav-enabled" className="text-base font-medium">
            {t('webdav.config.enable')}
          </Label>
          <p className="text-sm text-muted-foreground">{t('webdav.config.enableHint')}</p>
        </div>
        <Switch id="webdav-enabled" checked={webdavConfig.enabled} onCheckedChange={s.setWebDAVEnabled} />
      </div>

      <Separator />

      {webdavConfig.enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                {t('webdav.config.serverTitle')}
              </CardTitle>
              <CardDescription>{t('webdav.config.serverDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="server-url" label={t('webdav.config.serverUrl')}>
                <Input
                  id="server-url"
                  placeholder="https://dav.jianguoyun.com/dav/"
                  value={webdavConfig.serverUrl}
                  onChange={(e) => s.setWebDAVServerUrl(e.target.value)}
                />
              </Field>
              <Field id="username" label={t('webdav.config.username')}>
                <Input
                  id="username"
                  placeholder="your-email@example.com"
                  value={webdavConfig.username}
                  onChange={(e) => s.setWebDAVUsername(e.target.value)}
                />
              </Field>
              <Field id="password" label={t('webdav.config.password')}>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={
                      hasSecret && !passwordDraft
                        ? t('webdav.config.passwordKeepPlaceholder')
                        : t('webdav.config.passwordPlaceholder')
                    }
                    value={passwordDraft}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('webdav.config.hidePassword') : t('webdav.config.showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {hasSecret && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">{t('webdav.config.passwordConfigured')}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={handleClearPassword}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('webdav.config.clearPassword')}
                    </Button>
                  </div>
                )}
              </Field>
              <Field id="app-name" label={t('webdav.config.appName')}>
                <Input
                  id="app-name"
                  placeholder="fastReader_by_PF"
                  value={webdavConfig.appName}
                  onChange={(e) => s.setWebDAVAppName(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                {t('webdav.config.testTitle')}
              </CardTitle>
              <CardDescription>{t('webdav.config.testDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {STATUS_ICON[statusKey] ?? <XCircle className="h-4 w-4 text-muted-foreground/70" />}
                  <span className="text-sm">{t(`webdav.config.status.${statusKey}`)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void testConnection()} disabled={isTesting}>
                    {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    {isTesting ? t('webdav.config.testing') : t('config.testConnection')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    {t('webdav.config.reset')}
                  </Button>
                </div>
              </div>

              {testResult && (
                <Alert className={testResult.success ? 'border-green-200' : 'border-red-200'}>
                  <AlertDescription>{testResult.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                {t('webdav.config.syncTitle')}
              </CardTitle>
              <CardDescription>{t('webdav.config.syncDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-sync">{t('webdav.config.autoSync')}</Label>
                  <p className="text-sm text-muted-foreground">{t('webdav.config.autoSyncHint')}</p>
                </div>
                <Switch id="auto-sync" checked={webdavConfig.autoSync} onCheckedChange={s.setWebDAVAutoSync} />
              </div>
              <Field id="browse-path" label={t('webdav.config.browsePath')} hint={t('webdav.config.browsePathHint')}>
                <Input
                  id="browse-path"
                  placeholder="/"
                  value={webdavConfig.browsePath}
                  onChange={(e) => s.setWebDAVBrowsePath(e.target.value)}
                />
              </Field>
              <Field id="sync-path" label={t('webdav.config.syncPath')} hint={t('webdav.config.syncPathHint')}>
                <Input
                  id="sync-path"
                  placeholder="/fastReader"
                  value={webdavConfig.syncPath}
                  onChange={(e) => s.setWebDAVSyncPath(e.target.value)}
                />
              </Field>
              {webdavConfig.lastSyncTime && (
                <div className="text-sm text-muted-foreground">
                  {t('webdav.config.lastSync', { time: new Date(webdavConfig.lastSyncTime).toLocaleString() })}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p>
                  <strong>{t('webdav.config.helpTitle')}</strong>
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>{t('webdav.config.helpServer')}</li>
                  <li>{t('webdav.config.helpUsername')}</li>
                  <li>{t('webdav.config.helpPassword')}</li>
                  <li>{t('webdav.config.helpAppPassword')}</li>
                </ul>
                <div className="flex items-center gap-2 pt-2">
                  <ExternalLink className="h-4 w-4" />
                  <a
                    href="https://help.jianguoyun.com/?p=1464"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {t('webdav.config.helpLink')}
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">{t('webdav.config.proxyNote')}</p>
              </div>
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  )
}
