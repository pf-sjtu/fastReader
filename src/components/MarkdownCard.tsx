import React, { memo, useMemo, useState, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Trash2, BookOpen, ChevronDown, Copy, Eye, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ReactMarkdown, { type Options as MarkdownOptions } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { toast } from 'sonner'
import { prepareMarkdownForRender } from '@/lib/markdown'
import { ViewContentDialog } from './ViewContentDialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// 模块级常量：避免每次渲染新建插件数组导致 ReactMarkdown 重新处理
const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly]

export type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>

interface MarkdownCardProps {
  /** 章节ID */
  id: string
  /** 章节标题 */
  title: string
  /** 章节内容（原始内容） */
  content: string
  /** Markdown格式的总结内容 */
  markdownContent: string
  /** 章节索引 */
  index: number
  /** 是否显示序号（全书关联、全书总结这类单张卡不需要） */
  showIndex?: boolean
  /** 清除缓存的回调函数 */
  onClearCache?: (chapterId: string) => void
  /** 阅读章节的回调函数（参数为章节ID，便于父组件传稳定引用） */
  onReadChapter?: (chapterId: string) => void
  /** 是否显示清除缓存按钮 */
  showClearCache?: boolean
  /** 是否显示查看内容按钮 */
  showViewContent?: boolean
  /** 是否显示复制按钮 */
  showCopyButton?: boolean
  /** 是否显示阅读按钮 */
  showReadButton?: boolean
  /** 自定义类名 */
  className?: string
  /** 是否默认折叠 */
  defaultCollapsed?: boolean
  /** 外部控制是否展开 */
  isExpanded?: boolean
  /** 章节展开状态变化的回调（第二参数为章节ID，便于父组件传稳定引用） */
  onExpandChange?: (expanded: boolean, chapterId: string) => void
  /**
   * 追加的 remark 插件（如实体标注）。调用方必须保持引用稳定（useMemo），
   * 否则每次渲染都会让这张卡的 Markdown 重新处理。
   */
  extraRemarkPlugins?: RemarkPlugins
  /** 正文上方的插槽（如「本章出场」实体条）；仅展开时显示 */
  headerExtra?: ReactNode
}

/**
 * 章节卡。设计原则：标题是最重要的信息，不被按钮挤占。
 * - 折叠态只有「序号 + 衬线标题 + 箭头」，整行都是点击区（读屏：一个带 aria-expanded 的按钮）
 * - 操作（复制 / 阅读原文 / 更多）只在展开后，作为内容上方一条轻量工具栏出现
 * - 无阴影；折叠态悬停才有底色，展开态保持安静
 */
export const MarkdownCard = memo(function MarkdownCard({
  id,
  title,
  content,
  markdownContent,
  index,
  showIndex = true,
  onClearCache,
  onReadChapter,
  showClearCache = true,
  showViewContent = true,
  showCopyButton = true,
  showReadButton = true,
  className = '',
  defaultCollapsed = false,
  isExpanded,
  onExpandChange,
  extraRemarkPlugins,
  headerExtra,
}: MarkdownCardProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [viewOpen, setViewOpen] = useState(false)
  const remarkPlugins = useMemo(
    () => (extraRemarkPlugins?.length ? [...REMARK_PLUGINS, ...extraRemarkPlugins] : REMARK_PLUGINS),
    [extraRemarkPlugins]
  )

  // 使用外部控制的展开状态，外部控制优先级更高
  const actualIsCollapsed = isExpanded !== undefined ? !isExpanded : isCollapsed

  // 当外部控制的展开状态变化时，同步内部状态
  React.useEffect(() => {
    if (isExpanded !== undefined) {
      setIsCollapsed(!isExpanded)
    }
  }, [isExpanded])

  const handleToggleCollapse = () => {
    if (isExpanded !== undefined) {
      // 外部控制模式
      onExpandChange?.(!isExpanded, id)
    } else {
      // 内部控制模式
      setIsCollapsed(!isCollapsed)
    }
  }

  // 预处理只依赖内容：流式更新其他章节时不重复计算
  const renderedMarkdown = useMemo(() => prepareMarkdownForRender(markdownContent), [markdownContent])

  const canClear = showClearCache && !!onClearCache
  const canRead = showReadButton && !!onReadChapter
  const hasMenu = showViewContent || canClear
  const hasToolbar = showCopyButton || canRead || hasMenu

  const copy = () => {
    if (!markdownContent) return
    void navigator.clipboard.writeText(markdownContent)
    toast.success(t('common.copiedToClipboard'), { duration: 2000, position: 'top-center' })
  }

  const toggleLabel = actualIsCollapsed ? t('common.expand') : t('common.collapse')

  return (
    <Card
      id={`chapter-summary-${id}`}
      className={cn('min-w-0 gap-0 overflow-hidden py-0 shadow-none transition-colors', actualIsCollapsed && 'hover:bg-accent/30', className)}
    >
      <button
        type="button"
        onClick={handleToggleCollapse}
        aria-expanded={!actualIsCollapsed}
        aria-label={`${toggleLabel}：${title}`}
        title={toggleLabel}
        className="flex w-full items-start gap-3 px-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-4"
      >
        {showIndex && <span className="mt-[0.3em] w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>}
        <span className="font-brand min-w-0 flex-1 text-[15px] font-semibold leading-snug sm:text-base">{title}</span>
        <ChevronDown className={cn('mt-[0.3em] size-4 shrink-0 text-muted-foreground transition-transform', !actualIsCollapsed && 'rotate-180')} aria-hidden="true" />
      </button>

      {!actualIsCollapsed && (
        <CardContent className="min-w-0 px-3 pb-4 pt-0 sm:px-4">
          {hasToolbar && (
            <div className="-ml-2 mb-2 flex flex-wrap items-center gap-0.5 text-muted-foreground" role="toolbar" aria-label={title}>
              {showCopyButton && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={copy} disabled={!markdownContent} title={t('common.copyChapterSummary')}>
                  <Copy className="size-3.5" />
                  {t('common.copy')}
                </Button>
              )}
              {canRead && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => onReadChapter!(id)} title={t('common.readChapter')}>
                  <BookOpen className="size-3.5" />
                  {t('common.readChapter')}
                </Button>
              )}
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" title={t('common.moreActions')} aria-label={t('common.moreActions')} className="h-8 w-8 p-0">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {showViewContent && (
                      <DropdownMenuItem onSelect={() => setViewOpen(true)}>
                        <Eye className="size-4" />
                        {t('viewContent.originalText')}
                      </DropdownMenuItem>
                    )}
                    {showViewContent && canClear && <DropdownMenuSeparator />}
                    {canClear && (
                      <DropdownMenuItem variant="destructive" onSelect={() => onClearCache!(id)}>
                        <Trash2 className="size-4" />
                        {t('common.clearCache')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
          {headerExtra}
          <div className="markdown-card-content prose prose-sm max-w-none overflow-x-auto">
            {/*
              强调作用域：micromark (CommonMark delimiter run) + remark-cjk-friendly
              预处理只清 AI 脏源文（内侧空格、段中 >），不手写配对。
            */}
            <ReactMarkdown remarkPlugins={remarkPlugins}>
              {renderedMarkdown}
            </ReactMarkdown>
          </div>
        </CardContent>
      )}

      {showViewContent && (
        <ViewContentDialog title={title} content={content} chapterIndex={index} contentType="text" open={viewOpen} onOpenChange={setViewOpen} />
      )}
    </Card>
  )
})
