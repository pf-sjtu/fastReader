import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trash2, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { normalizeMarkdownTypography } from '@/lib/markdown'
import { CopyButton } from '@/components/ui/copy-button'
import { ViewContentDialog } from './ViewContentDialog'
import { useTranslation } from 'react-i18next'

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
    <Card id={`chapter-summary-${id}`} className={`gap-2 ${className}`}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <Badge variant="outline"># {index + 1}</Badge>
          <div className="truncate flex-1 w-1" title={title}>
            {title}
          </div>
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
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {showReadButton && onReadChapter && (
            <Button variant="outline" size="sm" onClick={onReadChapter}>
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
            title={actualIsCollapsed ? t('common.expand') : t('common.collapse')}
          >
            {actualIsCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      {!actualIsCollapsed && (
        <CardContent>
          <div className="markdown-card-content prose prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm,remarkCjkFriendly]}>
              {normalizeMarkdownTypography(markdownContent)}
            </ReactMarkdown>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
