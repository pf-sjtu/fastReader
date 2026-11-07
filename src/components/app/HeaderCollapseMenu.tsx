// 窄屏顶栏的「更多操作」：把同步状态、语言、主题、登出收进一个菜单。
// 只在顶栏容器 <512px 时渲染（见 AppHeader 的 HeaderTools），与独立控件共用同一份状态来源。
import { Check, Languages, LogOut, Moon, MoreHorizontal, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { languages } from '@/components/LanguageSwitcher'
import { useSyncStatusView } from '@/components/SyncStatusIndicator'
import { useIsDarkMode, useTheme } from '@/components/useTheme'
import { sharedApi } from '@/services/shared/api'
import { cn } from '@/lib/utils'

export function HeaderCollapseMenu() {
  const { t, i18n } = useTranslation()
  const { setTheme } = useTheme()
  const isDark = useIsDarkMode()
  const sync = useSyncStatusView()

  const handleLogout = async () => {
    try {
      await sharedApi.logout()
    } catch {
      toast.error(t('auth.logoutFailed'))
    } finally {
      // 用整页跳转清空所有内存态，避免残留其他人的配置
      window.location.reload()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('common.moreActions')}
          title={t('common.moreActions')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => {
              void i18n.changeLanguage(language.code)
            }}
            className="flex items-center gap-2"
          >
            <Languages className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {language.flag} {language.name}
            </span>
            {i18n.language === language.code && <Check className="h-4 w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')} className="flex items-center gap-2">
          {isDark ? (
            <Sun className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{isDark ? t('theme.light') : t('theme.dark')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="flex items-center gap-2">
          <sync.Icon className={cn('h-4 w-4 shrink-0', sync.className)} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{sync.label}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleLogout()} className="flex items-center gap-2">
          <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{t('auth.logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
