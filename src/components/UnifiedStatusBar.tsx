import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ModelSwitcher } from './ModelSwitcher'
import { Badge } from '@/components/ui/badge'
import { Brain, BookMarked, Loader2, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import { useTokenUsage } from '@/stores/configStore'
import { RecentHistoryMenu } from '@/components/RecentHistoryMenu'
import { ProcessingHistoryDialog } from '@/components/ProcessingHistoryDialog'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'
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

/** 需二次确认的破坏性操作：仅中止 / 中止并返回配置 */
type PendingAction = 'abort' | 'abortToConfig' | null

/** 工作台的三个阶段：书库 → 设置 → 处理 */
type Stage = 'library' | 'settings' | 'processing'

interface UnifiedStatusBarProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  progress?: number
  currentStep?: string
  processingMode?: 'summary' | 'mindmap' | 'combined-mindmap'
  onToggleView?: () => void
  onLoadFromHistory?: (record: ProcessingHistoryRecord) => Promise<boolean>
  onCancelProcessing?: () => void
  /** 按当前配置清空结果并重新跑完整处理 */
  onRestartProcessing?: () => void
  /** 中止并回到配置页改设置 */
  onAbortToConfig?: () => void
  /** 三阶段切换里显示「书库」（WebDAV 启用时才有书库）；「设置」「处理」始终有 */
  configSections?: boolean
  configSection?: 'library' | 'process'
  onSelectConfigSection?: (section: 'library' | 'process') => void
  className?: string
}

const MODE_LABEL_KEY: Record<string, string> = {
  summary: 'statusBar.mode.summary',
  mindmap: 'statusBar.mode.mindmap',
  'combined-mindmap': 'statusBar.mode.combinedMindmap',
}

export const UnifiedStatusBar = memo(function UnifiedStatusBar({
  currentView,
  processing = false,
  progress = 0,
  currentStep = '',
  processingMode,
  onToggleView,
  onLoadFromHistory,
  onCancelProcessing,
  onRestartProcessing,
  onAbortToConfig,
  configSections = false,
  configSection = 'process',
  onSelectConfigSection,
  className
}: UnifiedStatusBarProps) {
  const { t } = useTranslation()
  const records = useProcessingHistoryStore((s) => s.records)
  // 状态栏自行订阅 token 计数：高频变化只重渲染状态栏，不波及 App
  const tokenUsage = useTokenUsage()
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)

  const handleHistorySelect = async (record: ProcessingHistoryRecord) => {
    if (!onLoadFromHistory) return
    setLoadingFileName(record.fileName)
    try {
      const success = await onLoadFromHistory(record)
      if (success) {
        setHistoryDialogOpen(false)
      }
    } finally {
      setLoadingFileName(null)
    }
  }

  // 三个阶段：书库 → 设置 → 处理，平等的一组切换。书库只在 WebDAV 启用时有；「设置」与「书库」是配置页的两段，「处理」是结果视图
  const stage: Stage = currentView === 'processing' ? 'processing' : configSections && configSection === 'library' ? 'library' : 'settings'
  // 从结果视图切回「书库 / 设置」要中止正在跑的处理：先确认，确认后再切到点的那一段
  const [targetSection, setTargetSection] = useState<'library' | 'process' | null>(null)

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
      setPendingAction('abortToConfig')
      return
    }
    onSelectConfigSection?.(section)
    onToggleView?.()
  }

  // 等待确认期间处理已自然结束：撤销确认框，避免下次处理时残留弹出
  useEffect(() => {
    if (!processing) setPendingAction(null)
  }, [processing])

  const handleConfirmPending = () => {
    if (pendingAction === 'abort') onCancelProcessing?.()
    else if (pendingAction === 'abortToConfig') {
      onAbortToConfig?.()
      if (targetSection) onSelectConfigSection?.(targetSection)
    }
    setTargetSection(null)
    setPendingAction(null)
  }

  // 进度条：处理中始终显示；结束后仅在处理视图保留（完成 / 中断后的进度与「重新处理」）。
  // 配置视图不看残留的 progress，否则跑完一次后历史入口与「就绪」提示永远被进度条挡住
  const showProgress = processing || (currentView === 'processing' && progress > 0)

  // 显示最近历史的条件：配置视图 + 当前没有在跑 + 有历史记录 + 有回调
  const showRecentHistory =
    currentView === 'config' &&
    !processing &&
    records.length > 0 &&
    !!onLoadFromHistory

  const stages: { id: Stage; icon: LucideIcon; label: string }[] = [
    ...(configSections ? [{ id: 'library' as const, icon: BookMarked, label: t('statusBar.library') }] : []),
    { id: 'settings', icon: SlidersHorizontal, label: t('statusBar.settings') },
    { id: 'processing', icon: Brain, label: t('statusBar.process') },
  ]

  return (
    <>
      {/* 无卡片外框：它只是一条工具行，框起来会和下面真正的内容卡片（书库、上传）抢层级 */}
      <div data-slot="status-bar" className={cn('w-full min-w-0 px-0.5 py-1 sm:px-1', className)}>
        {/* sm–lg：左右两组占第一行，进度区（中间）整行落到第二行；≥lg 才三栏并排——768 宽三栏会把进度区挤到 0 宽，与模型选择器叠在一起 */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 lg:flex-nowrap">
          {/* 切换按钮 + 模型信息（移动端同一行） */}
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3 shrink-0">
            {/* 三阶段切换：书库 · 设置 · 处理。就是一组平等的分段，没有特殊按钮；结果视图里同样显示，当前停在「处理」。
                书库要能随时回去看一眼，而不是选完书就被表单顶掉；处理中切回前两段会先确认（要中止处理） */}
            <div role="tablist" aria-label={t('statusBar.sections')} data-slot="status-nav" className="flex items-center gap-0.5 rounded-md border p-0.5">
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

            <div className="flex items-center gap-2 sm:hidden">
              {/* 模型徽章即切换器：换模型 / 调思考强度 都在这里 */}
              <ModelSwitcher disabled={processing} tokenUsage={tokenUsage} className="max-w-[11rem]" />
              {processing && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* 中间：进度条 / 最近历史 / 状态信息 */}
          <div className="flex-1 min-w-0 mx-0 sm:order-last sm:basis-full lg:order-none lg:basis-auto lg:mx-6">
            {showProgress ? (
              <div className="space-y-2">
                {/* 可换行：顶栏变窄时步骤文字让到下一行，而不是被压成 0 宽、让按钮组溢出到模型切换器上 */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                  <span className="text-muted-foreground truncate min-w-0 flex-1 basis-28">
                    {processing ? currentStep : t('statusBar.completed')}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round(progress)}%
                    </span>
                    {processing && onCancelProcessing && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => setPendingAction('abort')}
                      >
                        {t('progress.abort')}
                      </Button>
                    )}
                    {processing && onAbortToConfig && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs hidden sm:inline-flex"
                        onClick={() => setPendingAction('abortToConfig')}
                        title={t('progress.abortAndEditSettings')}
                      >
                        {t('progress.abortAndEditSettingsShort')}
                      </Button>
                    )}
                    {!processing && onRestartProcessing && (
                      <Button
                        // 未完成（中断）时强调为主操作；已完成时降为次要
                        variant={progress < 100 ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={onRestartProcessing}
                      >
                        {t('progress.restart')}
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            ) : showRecentHistory ? (
              <div className="flex min-w-0 justify-center">
                <RecentHistoryMenu
                  records={records}
                  loadingFileName={loadingFileName}
                  onSelect={handleHistorySelect}
                  onViewAll={() => setHistoryDialogOpen(true)}
                />
              </div>
            ) : null /* 没有进度也没有历史时留白：「准备就绪 / 查看处理结果」这类复述界面状态的文字没有信息量 */}
          </div>

          {/* 右侧：模式 / Key / 模型（桌面） */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {processingMode && (
              <Badge variant="outline" className="text-xs font-normal">
                {MODE_LABEL_KEY[processingMode] ? t(MODE_LABEL_KEY[processingMode]) : processingMode}
              </Badge>
            )}
            {/* 未配置密钥时切换器本身会标红并显示提示，不再单独放一个红色徽章 */}
            <ModelSwitcher disabled={processing} tokenUsage={tokenUsage} />

            {processing && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'abortToConfig'
                ? t('progress.confirmAbortToConfigTitle')
                : t('progress.confirmAbortTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'abortToConfig'
                ? t('progress.confirmAbortToConfigDescription')
                : t('progress.confirmAbortDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPending}>
              {pendingAction === 'abortToConfig'
                ? t('progress.abortAndEditSettings')
                : t('progress.abort')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProcessingHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        onSelectRecord={handleHistorySelect}
      />
    </>
  )
})
