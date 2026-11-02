import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Brain, BookMarked, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** 工作台的三个阶段：书库 → 设置 → 处理 */
type Stage = 'library' | 'settings' | 'processing'

export interface StageNavProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  /** 显示「书库」这一段（WebDAV 启用时才有书库） */
  configSections?: boolean
  configSection?: 'library' | 'process'
  onSelectConfigSection?: (section: 'library' | 'process') => void
  /** 在配置视图与结果视图之间切换 */
  onToggleView?: () => void
  onCancelProcessing?: () => void
  /** 中止处理并回到配置页改设置 */
  onAbortToConfig?: () => void
  className?: string
}

/**
 * 三阶段切换：书库 · 设置 · 处理。就是一组平等的分段，没有特殊按钮；结果视图里同样显示，
 * 当前停在「处理」。书库要能随时回去看一眼，而不是选完书就被表单顶掉；处理中切回前两段会先
 * 确认（要中止处理）。
 *
 * 从状态栏里拆出来：工作台模式下它下沉到正文列顶部（顶栏只留品牌、书名与工具），
 * 经典布局仍由状态栏渲染同一份。
 */
export function StageNav({
  currentView,
  processing = false,
  configSections = false,
  configSection = 'process',
  onSelectConfigSection,
  onToggleView,
  onAbortToConfig,
  className,
}: StageNavProps) {
  const { t } = useTranslation()
  // 从结果视图切回「书库 / 设置」要中止正在跑的处理：先确认，确认后再切到点的那一段
  const [targetSection, setTargetSection] = useState<'library' | 'process' | null>(null)

  const stage: Stage =
    currentView === 'processing' ? 'processing' : configSections && configSection === 'library' ? 'library' : 'settings'

  const goStage = (next: Stage) => {
    if (next === stage) return
    if (next === 'processing') {
      onToggleView?.()
      return
    }
    const section = next === 'library' ? 'library' : 'process'
    if (currentView === 'config') {
      onSelectConfigSection?.(section)
      return
    }
    if (processing && onAbortToConfig) {
      setTargetSection(section)
      return
    }
    onSelectConfigSection?.(section)
    onToggleView?.()
  }

  // 等待确认期间处理已自然结束：撤销确认框，避免下次处理时残留弹出
  useEffect(() => {
    if (!processing) setTargetSection(null)
  }, [processing])

  const stages: { id: Stage; icon: LucideIcon; label: string }[] = [
    ...(configSections ? [{ id: 'library' as const, icon: BookMarked, label: t('statusBar.library') }] : []),
    { id: 'settings', icon: SlidersHorizontal, label: t('statusBar.settings') },
    { id: 'processing', icon: Brain, label: t('statusBar.process') },
  ]

  return (
    <>
      <div
        role="tablist"
        aria-label={t('statusBar.sections')}
        data-slot="status-nav"
        className={cn('flex items-center gap-0.5 rounded-md border p-0.5', className)}
      >
        {stages.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            role="tab"
            aria-selected={stage === id}
            aria-label={label}
            variant={stage === id ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => goStage(id)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}
      </div>

      <AlertDialog open={targetSection !== null} onOpenChange={(open) => !open && setTargetSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('progress.confirmAbortToConfigTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('progress.confirmAbortToConfigDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onAbortToConfig?.()
                if (targetSection) onSelectConfigSection?.(targetSection)
                setTargetSection(null)
              }}
            >
              {t('progress.abortAndEditSettings')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
