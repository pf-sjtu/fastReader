import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Button } from "./ui/button"
import { ScrollArea } from "./ui/scroll-area"
import { Eye } from "lucide-react"
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { prepareMarkdownForRender } from '@/lib/markdown'
import { sanitizeBookHtml } from '@/utils/sanitizeHtml'
import { richMarkdownComponents } from '@/components/markdown/richComponents'

// 模块级常量：避免每次渲染新建插件数组
const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly]

interface ViewContentDialogProps {
  title: string
  content: string
  chapterIndex: number
  contentType?: 'text' | 'markdown' | 'html'
  /** 受控模式：由外部（如更多菜单）打开，不渲染自带的触发按钮 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ViewContentDialog({ title, content, chapterIndex, contentType = 'text', open, onOpenChange }: ViewContentDialogProps) {
  const { t } = useTranslation()
  
  const renderContent = () => {
    switch (contentType) {
      case 'markdown':
        return (
          <div className="markdown-card-content prose prose-sm">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={richMarkdownComponents}>
              {prepareMarkdownForRender(content)}
            </ReactMarkdown>
          </div>
        )
      case 'html':
        return (
          <div 
            className="text-muted-foreground leading-relaxed text-sm max-w-none w-full break-words"
            dangerouslySetInnerHTML={{ __html: sanitizeBookHtml(content || '') }}
          />
        )
      default:
        return (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
          </div>
        )
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open === undefined && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('viewContent.originalText')}
            title={t('viewContent.originalText')}
          >
            <Eye className="h-4 w-4 " />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] w-full flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-wrap break-words">{title} - {t('viewContent.originalText')}</DialogTitle>
          <DialogDescription className="text-wrap break-words">
            {t('viewContent.chapterContent', { chapter: chapterIndex + 1 })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 w-full rounded-md border p-4 min-h-0">
          <div className="max-w-none">
            {renderContent()}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}