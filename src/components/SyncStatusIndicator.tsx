// 顶栏的同步状态 + 登出
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, CloudOff, RefreshCw, AlertTriangle, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSyncStatusStore } from '@/services/shared/sharedState'
import { sharedApi } from '@/services/shared/api'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return '—'
  }
}

export function SyncStatusIndicator() {
  const { t } = useTranslation()
  const { status, lastSyncedAt, conflicts } = useSyncStatusStore()
  const notified = useRef('')

  // 冲突只在 tooltip 里，用户基本看不到 → 第一次出现时弹一条 toast
  useEffect(() => {
    const signature = conflicts.join('|')
    if (!signature || signature === notified.current) return
    notified.current = signature
    toast.warning(t('sync.conflict'), {
      description: t('sync.conflictDescription', { fields: conflicts.join(', ') }),
      duration: 8000,
    })
  }, [conflicts, t])

  const view = (() => {
    switch (status) {
      case 'loading':
        return { Icon: RefreshCw, className: 'text-muted-foreground animate-spin', label: t('sync.loading') }
      case 'syncing':
        return { Icon: RefreshCw, className: 'text-muted-foreground animate-spin', label: t('sync.syncing') }
      case 'conflict':
        return { Icon: AlertTriangle, className: 'text-amber-500', label: t('sync.conflict') }
      case 'offline':
        return { Icon: CloudOff, className: 'text-destructive', label: t('sync.offline') }
      case 'error':
        return { Icon: CloudOff, className: 'text-destructive', label: t('sync.error') }
      default:
        return { Icon: Cloud, className: 'text-muted-foreground', label: t('sync.synced') }
    }
  })()

  const { Icon, className, label } = view

  const handleLogout = async () => {
    try {
      await sharedApi.logout()
    } finally {
      // 用整页跳转清空所有内存态，避免残留其他人的配置
      window.location.reload()
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex h-8 w-8 items-center justify-center"
              aria-label={label}
              role="status"
              aria-live="polite"
            >
              <Icon className={`h-3.5 w-3.5 ${className}`} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-xs">
              {label}
              {status === 'idle' && ` · ${formatTime(lastSyncedAt)}`}
              {conflicts.length > 0 && <span className="block mt-1">{conflicts.join(', ')}</span>}
            </p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                void handleLogout().catch(() => toast.error(t('auth.logoutFailed')))
              }}
              aria-label={t('auth.logout')}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{t('auth.logout')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
