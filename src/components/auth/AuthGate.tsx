// 启动门：会话探测 → 登录 → 拉取共享状态 → （服务端为空时）初始化向导
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { LoginPage } from './LoginPage'
import { InitWizard } from '@/components/onboarding/InitWizard'
import { sharedApi, SESSION_EXPIRED_EVENT, UnauthorizedError } from '@/services/shared/api'
import { installAutoFlush, loadAll, useSyncStatusStore } from '@/services/shared/sharedState'
import { logger } from '@/lib/logger'

type GateState = 'checking' | 'login' | 'loading' | 'onboarding' | 'ready' | 'error'

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<GateState>('checking')
  const [error, setError] = useState<string | null>(null)
  const setSyncStatus = useSyncStatusStore((s) => s.setStatus)

  const bootstrap = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const { initialized } = await loadAll()
      setState(initialized ? 'ready' : 'onboarding')
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setState('login')
        return
      }
      logger.error('[AuthGate] 拉取共享状态失败:', err)
      setError(err instanceof Error ? err.message : String(err))
      setSyncStatus('error', { error: err instanceof Error ? err.message : String(err) })
      setState('error')
    }
  }, [setSyncStatus])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const authed = await sharedApi.me()
      if (cancelled) return
      if (!authed) {
        setState('login')
        return
      }
      await bootstrap()
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrap])

  // 会话失效（改了密码 / 过期 / 登出于他处）→ 回登录页，而不是让用户继续编辑却写不进去
  useEffect(() => {
    const onExpired = () => setState('login')
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  // 登录后：定期/聚焦刷新 + 卸载前落盘
  useEffect(() => {
    if (state !== 'ready' && state !== 'onboarding') return
    return installAutoFlush()
  }, [state])

  if (state === 'checking' || state === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('auth.loading')}
        </div>
      </div>
    )
  }

  if (state === 'login') {
    return <LoginPage onSuccess={() => void bootstrap()} />
  }

  if (state === 'onboarding') {
    return <InitWizard onDone={bootstrap} />
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md space-y-3 text-center">
          <p className="text-sm text-destructive">{t('auth.loadFailed')}</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
          <button
            type="button"
            className="text-sm underline text-primary"
            onClick={() => void bootstrap()}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
