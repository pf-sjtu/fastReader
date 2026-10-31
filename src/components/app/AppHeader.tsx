import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/BrandMark'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'

/** 右上角工具组：同步状态 + 语言 + 明暗 */
function HeaderTools() {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <SyncStatusIndicator />
      <LanguageSwitcher />
      <DarkModeToggle />
    </div>
  )
}

/**
 * 页头。compact（阅读工作台）压成单行：品牌 + 状态栏（children）+ 工具，把高度让给阅读；
 * 窄屏时 children 另起一行。否则是带副标题的完整页头（桌面居中、手机左对齐），children 不在这里渲染。
 */
export function AppHeader({ compact, children }: { compact: boolean; children?: ReactNode }) {
  const { t } = useTranslation()

  if (compact) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="shrink-0">
          <BrandMark name={t('app.title')} latin={t('app.latin')} size="sm" />
        </h1>
        {children && <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0">{children}</div>}
        <div className="ml-auto sm:ml-0">
          <HeaderTools />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 sm:block sm:relative sm:space-y-2 sm:text-center">
      <div className="flex items-center justify-between gap-2 sm:absolute sm:top-0 sm:right-0 sm:justify-end">
        <div className="sm:hidden flex-1 min-w-0">
          <h1 className="min-w-0">
            <BrandMark name={t('app.title')} latin={t('app.latin')} size="sm" />
          </h1>
        </div>
        <HeaderTools />
      </div>
      <div className="hidden sm:flex flex-col items-center gap-3 pt-1">
        <h1>
          <BrandMark name={t('app.title')} latin={t('app.latin')} />
        </h1>
        <p className="font-brand text-sm text-muted-foreground">{t('app.description')}</p>
      </div>
      <p className="sm:hidden font-brand text-sm text-muted-foreground">{t('app.description')}</p>
    </div>
  )
}
