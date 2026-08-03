import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Button } from "./ui/button"
import { ScrollArea } from "./ui/scroll-area"
import { Eye } from "lucide-react"
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from "remark-cjk-friendly";
import { prepareMarkdownForRender } from '@/lib/markdown'

interface ViewContentDialogProps {
  title: string
  content: string
  chapterIndex: number
  contentType?: 'text' | 'markdown' | 'html'
}

export function ViewContentDialog({ title, content, chapterIndex, contentType = 'text' }: ViewContentDialogProps) {
  const { t } = useTranslation()
  
  const renderContent = () => {
    switch (contentType) {
      case 'markdown':
        return (
          <div className="markdown-card-content prose prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
              {prepareMarkdownForRender(content)}
            </ReactMarkdown>
          </div>
        )
      case 'html':
        return (
          <div 
            className="text-gray-700 dark:text-gray-200 leading-relaxed text-sm max-w-none w-full break-words"
            dangerouslySetInnerHTML={{ __html: content || '' }}
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
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
        >
          <Eye className="h-4 w-4 " />
        </Button>
      </DialogTrigger>
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