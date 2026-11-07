import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface NavRailProps {
  chapters: readonly { id: string; title: string }[]
  /** 当前阅读章序号（1 起；0 = 尚未定位） */
  current: number
  /** 处理中：轨道画处理进度而不是阅读进度 */
  processing?: boolean
  /** 处理中已完成的章数（0 = 一章还没跑完） */
  processedCount?: number
  /** 正在处理的那一章 id（点状模式下给它脉冲） */
  processingChapterId?: string
  onExpand: () => void
}

/** 章节太多时圆点会挤成一团：超过这个数只画进度线，不画点 */
export const MAX_RAIL_DOTS = 40

/**
 * 目录折叠后的极窄竖向进度条（圆点模式）：一条轨道 + 每章一个点。
 * 读过的章节点亮、当前章放大高亮、已读部分的轨道填充；悬停某个点显示章节标题。
 * 处理中换成处理进度：已完成段主色、正在处理的那一章高度用 info 色脉冲，
 * 这样目录收起时也能看出「跑到哪一章了」。
 * 整条可点击展开（用一个铺满的透明按钮承载，语义上的 progressbar 与交互分开，避免按钮套进度条）。
 */
export function NavRail({
  chapters,
  current,
  processing = false,
  processedCount = 0,
  processingChapterId,
  onExpand,
}: NavRailProps) {
  const { t } = useTranslation()
  const total = chapters.length
  const done = Math.min(Math.max(processedCount, 0), total)
  // 阅读进度按「当前章之前的比例」算（首章 0%）；处理进度按「已完成章数」算
  const readingPct = total > 1 ? ((Math.max(current, 1) - 1) / (total - 1)) * 100 : current > 0 ? 100 : 0
  const processedPct = total > 0 ? (done / total) * 100 : 0
  // 正在处理的那一章在轨道上占的高度：一章一份
  const processingSlicePct = total > 0 ? 100 / total : 0
  const pct = processing ? processedPct : readingPct
  const showDots = total > 0 && total <= MAX_RAIL_DOTS

  return (
    <div className="relative h-full w-3.5 shrink-0 py-2" data-processing={processing || undefined}>
      <div
        role="progressbar"
        aria-label={processing ? t('nav.processingProgress') : t('workspace.nav.progress')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={processing ? done : current}
        aria-valuetext={`${processing ? done : current}/${total}`}
        className="relative mx-auto h-full w-full"
      >
        {/* 轨道与已完成填充（处理中 = 已跑完的章，阅读中 = 当前阅读位置） */}
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border" />
        <span
          data-testid="rail-fill"
          className="absolute left-1/2 top-0 w-0.5 -translate-x-1/2 rounded-full bg-primary transition-[height]"
          style={{ height: `${pct}%` }}
        />
        {/* 处理中：正在生成的那一章高度，独立 info 色并呼吸 */}
        {processing && total > 0 && (
          <span
            data-testid="rail-processing-segment"
            className="rail-processing-pulse absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-info"
            style={{ top: `${processedPct}%`, height: `${processingSlicePct}%` }}
          />
        )}
        {showDots && (
          <ol className="absolute inset-0 flex flex-col justify-between">
            {chapters.map((c, i) => {
              const state = processing
                ? i + 1 <= done
                  ? 'done'
                  : c.id === processingChapterId
                    ? 'processing'
                    : 'todo'
                : i + 1 === current
                  ? 'current'
                  : i + 1 < current
                    ? 'read'
                    : 'todo'
              return (
                <li key={c.id} title={c.title} data-state={state} className="flex justify-center">
                  <span
                    className={cn(
                      'block rounded-full transition-all',
                      state === 'current' && 'size-2.5 bg-primary ring-2 ring-primary/30',
                      state === 'read' && 'size-1.5 bg-primary',
                      state === 'done' && 'size-1.5 bg-primary',
                      state === 'processing' && 'rail-processing-pulse-dot size-2.5 bg-info ring-2 ring-info/30',
                      state === 'todo' && 'size-1.5 border border-muted-foreground/50 bg-background'
                    )}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <button
        type="button"
        onClick={onExpand}
        aria-label={t('workspace.nav.expand')}
        title={t('workspace.nav.expand')}
        className="absolute inset-0 cursor-pointer rounded-md outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
