import { memo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ModelSwitcher } from './ModelSwitcher'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import { useTokenUsage } from '@/stores/configStore'
import { RecentHistoryMenu } from '@/components/RecentHistoryMenu'
import { ProcessingHistoryDialog } from '@/components/ProcessingHistoryDialog'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'
import { StageNav } from '@/components/app/StageNav'
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

const MODE_LABEL_KEY: Record<string, string> = {
  summary: 'statusBar.mode.summary',
  mindmap: 'statusBar.mode.mindmap',
  'combined-mindmap': 'statusBar.mode.combinedMindmap',
}

interface StatusProgressProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  progress?: number
  currentStep?: string
  onCancelProcessing?: () => void
  /** 按当前配置清空结果并重新跑完整处理 */
  onRestartProcessing?: () => void
  /** 中止并回到配置页改设置 */
  onAbortToConfig?: () => void
  onLoadFromHistory?: (record: ProcessingHistoryRecord) => Promise<boolean>
  /** 紧凑排版：一行（进度条 + 百分比 + 按钮），用于工作台正文列顶部下方 */
  compact?: boolean
  className?: string
}

/**
 * 中间那段：进度条 / 最近历史。
 *
 * 工作台模式下它与导航一起下沉到正文列顶部（顶栏只留品牌、书名与工具）；
 * 经典布局里由状态栏就地渲染。历史入口只在配置视图出现（结果视图没有「最近处理」）。
 */
export const StatusProgress = memo(function StatusProgress({
  currentView,
  processing = false,
  progress = 0,
  currentStep = '',
  onCancelProcessing,
  onRestartProcessing,
  onAbortToConfig,
  onLoadFromHistory,
  compact = false,
  className,
}: StatusProgressProps) {
  const { t } = useTranslation()
  const records = useProcessingHistoryStore((s) => s.records)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  // 「中止」是破坏性操作，要二次确认（从结果视图切回设置的那次确认在 StageNav 里）
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false)

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

  // 进度条：处理中始终显示；结束后仅在处理视图保留（完成 / 中断后的进度与「重新处理」）。
  // 配置视图不看残留的 progress，否则跑完一次后历史入口与「就绪」提示永远被进度条挡住
  const showProgress = processing || (currentView === 'processing' && progress > 0)

  // 显示最近历史的条件：配置视图 + 当前没有在跑 + 有历史记录 + 有回调
  const showRecentHistory =
    currentView === 'config' && !processing && records.length > 0 && !!onLoadFromHistory

  if (!showProgress && !showRecentHistory) {
    return null /* 没有进度也没有历史时留白：「准备就绪 / 查看处理结果」这类复述界面状态的文字没有信息量 */
  }

  return (
    <>
      <div className={cn('min-w-0', className)}>
        {showProgress ? (
          compact ? (
            /* 紧凑：进度条与数字、按钮同一行，单独占正文列顶部下方一条 */
            <div className="flex items-center gap-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {Math.round(progress)}%
              </span>
              {processing && onCancelProcessing && (
                <Button
                  variant="outline"
                  size="xs"
                  className="px-2 text-xs border-destructive-border text-destructive hover:bg-destructive-muted"
                  onClick={() => setAbortConfirmOpen(true)}
                >
                  {t('progress.abort')}
                </Button>
              )}
              {!processing && onRestartProcessing && (
                <Button
                  variant="outline"
                  size="xs"
                  className="px-2 text-xs"
                  onClick={onRestartProcessing}
                >
                  {t('progress.restart')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {/* 可换行：顶栏变窄时步骤文字让到下一行，而不是被压成 0 宽、让按钮组溢出到模型切换器上 */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                <span className="text-muted-foreground truncate min-w-0 flex-1 basis-28">
                  {processing ? currentStep : t('statusBar.completed')}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <span className="text-muted-foreground tabular-nums">{Math.round(progress)}%</span>
                  {processing && onCancelProcessing && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="px-2 text-xs border-destructive-border text-destructive hover:bg-destructive-muted"
                      onClick={() => setAbortConfirmOpen(true)}
                    >
                      {t('progress.abort')}
                    </Button>
                  )}
                  {processing && onAbortToConfig && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="px-2 text-xs hidden sm:inline-flex"
                      onClick={() => onAbortToConfig?.()}
                      title={t('progress.abortAndEditSettings')}
                    >
                      {t('progress.abortAndEditSettingsShort')}
                    </Button>
                  )}
                  {!processing && onRestartProcessing && (
                    <Button
                      // 未完成（中断）时强调为主操作；已完成时降为次要
                      variant={progress < 100 ? 'default' : 'outline'}
                      size="xs"
                      className="px-2 text-xs"
                      onClick={onRestartProcessing}
                    >
                      {t('progress.restart')}
                    </Button>
                  )}
                </div>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )
        ) : (
          <div className="flex min-w-0 justify-center">
            <RecentHistoryMenu
              records={records}
              loadingFileName={loadingFileName}
              onSelect={handleHistorySelect}
              onViewAll={() => setHistoryDialogOpen(true)}
            />
          </div>
        )}
      </div>

      <AlertDialog open={abortConfirmOpen} onOpenChange={setAbortConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('progress.confirmAbortTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('progress.confirmAbortDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onCancelProcessing?.()
                setAbortConfirmOpen(false)
              }}
            >
              {t('progress.abort')}
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

export interface UnifiedStatusBarProps {
  currentView: 'config' | 'processing'
  processing?: boolean
  progress?: number
  currentStep?: string
  processingMode?: 'summary' | 'mindmap' | 'combined-mindmap'
  /** 在配置视图与结果视图之间切换 */
  onToggleView?: () => void
  onLoadFromHistory?: (record: ProcessingHistoryRecord) => Promise<boolean>
  onCancelProcessing?: () => void
  /** 中止并回到配置页改设置 */
  onAbortToConfig?: () => void
  /** 显示「书库」这一段（WebDAV 启用时才有书库） */
  configSections?: boolean
  configSection?: 'library' | 'process'
  onSelectConfigSection?: (section: 'library' | 'process') => void
  /** 按当前配置清空结果并重新跑完整处理 */
  onRestartProcessing?: () => void
  /**
   * - `full`（默认）：导航 + 进度 + 模式/模型，经典布局用
   * - `meta`：只有「总结 / 模型切换器」，工作台顶栏用（导航与进度下沉到正文列顶部）
   */
  variant?: 'full' | 'meta'
  className?: string
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
  variant = 'full',
  className,
}: UnifiedStatusBarProps) {
  const { t } = useTranslation()
  // 状态栏自行订阅 token 计数：高频变化只重渲染状态栏，不波及 App
  const tokenUsage = useTokenUsage()

  const stageNav = (
    <StageNav
      currentView={currentView}
      processing={processing}
      configSections={configSections}
      configSection={configSection}
      onSelectConfigSection={onSelectConfigSection}
      onToggleView={onToggleView}
      onAbortToConfig={onAbortToConfig}
    />
  )

  // 工作台顶栏：只有「总结 / 模型切换器」，导航与进度在正文列顶部
  if (variant === 'meta') {
    return (
      <div data-slot="status-bar" className={cn('flex min-w-0 items-center gap-2', className)}>
        {processingMode && (
          <Badge variant="outline" className="text-xs font-normal">
            {MODE_LABEL_KEY[processingMode] ? t(MODE_LABEL_KEY[processingMode]) : processingMode}
          </Badge>
        )}
        {/* 未配置密钥时切换器本身会标红并显示提示，不再单独放一个红色徽章 */}
        <ModelSwitcher disabled={processing} tokenUsage={tokenUsage} />
        {processing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    )
  }

  return (
    <>
      {/* 无卡片外框：它只是一条工具行，框起来会和下面真正的内容卡片（书库、上传）抢层级 */}
      <div data-slot="status-bar" className={cn('w-full min-w-0 px-0.5 py-1 sm:px-1', className)}>
        {/* sm–lg：左右两组占第一行，进度区（中间）整行落到第二行；≥lg 才三栏并排——768 宽三栏会把进度区挤到 0 宽，与模型选择器叠在一起 */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 lg:flex-nowrap">
          {/* 切换按钮 + 模型信息（移动端同一行） */}
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3 shrink-0">
            {stageNav}

            <div className="flex items-center gap-2 sm:hidden">
              {/* 模型徽章即切换器：换模型 / 调思考强度 都在这里 */}
              <ModelSwitcher disabled={processing} tokenUsage={tokenUsage} className="max-w-[11rem]" />
              {processing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {/* 中间：进度条 / 最近历史 / 状态信息 */}
          <StatusProgress
            currentView={currentView}
            processing={processing}
            progress={progress}
            currentStep={currentStep}
            onCancelProcessing={onCancelProcessing}
            onRestartProcessing={onRestartProcessing}
            onAbortToConfig={onAbortToConfig}
            onLoadFromHistory={onLoadFromHistory}
            className="flex-1 min-w-0 mx-0 sm:order-last sm:basis-full lg:order-none lg:basis-auto lg:mx-6"
          />

          {/* 右侧：模式 / Key / 模型（桌面） */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {processingMode && (
              <Badge variant="outline" className="text-xs font-normal">
                {MODE_LABEL_KEY[processingMode] ? t(MODE_LABEL_KEY[processingMode]) : processingMode}
              </Badge>
            )}
            {/* 未配置密钥时切换器本身会标红并显示提示，不再单独放一个红色徽章 */}
            <ModelSwitcher disabled={processing} tokenUsage={tokenUsage} />

            {processing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
      </div>
    </>
  )
})
