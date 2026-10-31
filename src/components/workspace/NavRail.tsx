import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface NavRailProps {
  chapters: readonly { id: string; title: string }[]
  /** 当前阅读章序号（1 起；0 = 尚未定位） */
  current: number
  onExpand: () => void
}

/** 章节太多时圆点会挤成一团：超过这个数只画进度线，不画点 */
export const MAX_RAIL_DOTS = 40

/**
 * 目录折叠后的极窄竖向进度条（圆点模式）：一条轨道 + 每章一个点。
 * 读过的章节点亮、当前章放大高亮、已读部分的轨道填充；悬停某个点显示章节标题。
 * 整条可点击展开（用一个铺满的透明按钮承载，语义上的 progressbar 与交互分开，避免按钮套进度条）。
 */
export function NavRail({ chapters, current, onExpand }: NavRailProps) {
  const { t } = useTranslation()
  const total = chapters.length
  const pct = total > 1 ? ((Math.max(current, 1) - 1) / (total - 1)) * 100 : current > 0 ? 100 : 0
  const showDots = total > 0 && total <= MAX_RAIL_DOTS

  return (
    <div className="relative h-full w-3.5 shrink-0 py-2">
      <div
        role="progressbar"
        aria-label={t('workspace.nav.progress')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={`${current}/${total}`}
        className="relative mx-auto h-full w-full"
      >
        {/* 轨道与已读填充 */}
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border" />
        <span
          data-testid="rail-fill"
          className="absolute left-1/2 top-0 w-0.5 -translate-x-1/2 rounded-full bg-primary transition-[height]"
          style={{ height: `${pct}%` }}
        />
        {showDots && (
          <ol className="absolute inset-0 flex flex-col justify-between">
            {chapters.map((c, i) => {
              const state = i + 1 === current ? 'current' : i + 1 < current ? 'read' : 'todo'
              return (
                <li key={c.id} title={c.title} data-state={state} className="flex justify-center">
                  <span
                    className={cn(
                      'block rounded-full transition-all',
                      state === 'current' && 'size-2.5 bg-primary ring-2 ring-primary/30',
                      state === 'read' && 'size-1.5 bg-primary',
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
        className="absolute inset-0 cursor-pointer rounded outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
