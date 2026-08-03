import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trash2, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { prepareMarkdownForRender } from '@/lib/markdown'
import { CopyButton } from '@/components/ui/copy-button'
import { ViewContentDialog } from './ViewContentDialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

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
  /** 阅读章节的回调函数 */
  onReadChapter?: () => void
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
  /** 章节展开状态变化的回调 */
  onExpandChange?: (expanded: boolean) => void
}

export const MarkdownCard: React.FC<MarkdownCardProps> = ({
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
}) => {
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
      onExpandChange?.(!isExpanded)
    } else {
      // 内部控制模式
      setIsCollapsed(!isCollapsed)
    }
  }

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
            {showClearCache && onClearCache && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onClearCache(id)}
                title={t('common.clearCache')}
                className="h-8 w-8 p-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {showReadButton && onReadChapter && (
              <Button variant="outline" size="sm" onClick={onReadChapter} className="h-8 w-8 p-0">
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
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
              {prepareMarkdownForRender(markdownContent)}
            </ReactMarkdown>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
