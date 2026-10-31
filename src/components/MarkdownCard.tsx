import React, { memo, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trash2, BookOpen, ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { prepareMarkdownForRender } from '@/lib/markdown'
import { CopyButton } from '@/components/ui/copy-button'
import { ViewContentDialog } from './ViewContentDialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// 模块级常量：避免每次渲染新建插件数组导致 ReactMarkdown 重新处理
const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly]

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
}

export const MarkdownCard = memo(function MarkdownCard({
  id,
  title,
  content,
  markdownContent,
  index,
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
}: MarkdownCardProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

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

  return (
    <Card
      id={`chapter-summary-${id}`}
      className={cn('gap-2 min-w-0 py-2 sm:py-4', className)}
    >
      <CardHeader className="space-y-2 px-2.5 sm:px-4">
        <CardTitle className="text-base sm:text-lg flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Badge variant="outline" className="shrink-0"># {index + 1}</Badge>
            <div className="truncate min-w-0 flex-1" title={title}>
              {title}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapse}
              className="shrink-0 h-8 w-8 p-0 sm:hidden"
              title={actualIsCollapsed ? t('common.expand') : t('common.collapse')}
              aria-label={actualIsCollapsed ? t('common.expand') : t('common.collapse')}
              aria-expanded={!actualIsCollapsed}
            >
              {actualIsCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {showCopyButton && (
              <CopyButton
                content={markdownContent}
                successMessage={t('common.copiedToClipboard')}
                title={t('common.copyChapterSummary')}
              />
            )}
            {/* 破坏性的次要操作收进菜单：少一个常驻按钮，也避免手滑清掉缓存 */}
            {showClearCache && onClearCache && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    title={t('common.moreActions')}
                    aria-label={t('common.moreActions')}
                    className="h-8 w-8 p-0"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => onClearCache(id)}>
                    <Trash2 className="h-4 w-4" />
                    {t('common.clearCache')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {showReadButton && onReadChapter && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReadChapter(id)}
                className="h-8 w-8 p-0"
                title={t('common.readChapter')}
                aria-label={t('common.readChapter')}
              >
                <BookOpen className="h-3 w-3" />
              </Button>
            )}
            {showViewContent && (
              <ViewContentDialog
                title={title}
                content={content}
                chapterIndex={index}
                contentType="text"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapse}
              className="hidden sm:inline-flex h-8 w-8 p-0"
              title={actualIsCollapsed ? t('common.expand') : t('common.collapse')}
              aria-label={actualIsCollapsed ? t('common.expand') : t('common.collapse')}
              aria-expanded={!actualIsCollapsed}
            >
              {actualIsCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {!actualIsCollapsed && (
        <CardContent className="min-w-0 px-2.5 sm:px-4 pt-0">
          <div className="markdown-card-content prose prose-sm max-w-none overflow-x-auto">
            {/*
              强调作用域：micromark (CommonMark delimiter run) + remark-cjk-friendly
              预处理只清 AI 脏源文（内侧空格、段中 >），不手写配对。
            */}
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
              {renderedMarkdown}
            </ReactMarkdown>
          </div>
        </CardContent>
      )}
    </Card>
  )
})
