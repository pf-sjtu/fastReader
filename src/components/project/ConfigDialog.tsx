// 配置对话框：只做组合；各分区自行读写 store（即时保存）
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PromptEditor } from './PromptEditor'
import { WebDAVConfig } from './WebDAVConfig'
import { AIProviderConfig } from './AIProviderConfig'
import { ConfigExportImport } from '../ConfigExportImport'
import { AIServiceSection } from './config/AIServiceSection'
import { ProxySection } from './config/ProxySection'
import { RateLimitSection } from './config/RateLimitSection'
import { ProcessingSection } from './config/ProcessingSection'
import { ChapterSection } from './config/ChapterSection'
import { ChapterPreview } from './config/ChapterPreview'

/** 页签 value → 标题文案 key（标题跟随当前页签） */
const TAB_TITLE_KEY = {
  'ai-config': 'config.aiServiceConfig',
  'ai-providers': 'config.tabs.providers',
  prompts: 'promptEditor.title',
  webdav: 'config.tabs.webdav',
  'export-import': 'config.tabs.exportImport',
} as const
type ConfigTab = keyof typeof TAB_TITLE_KEY

interface ConfigDialogProps {
  processing: boolean
  file: File | null
}

export function ConfigDialog({ processing, file }: ConfigDialogProps) {
  const { t } = useTranslation()
  // 受控 open：章节预览仅在对话框打开时解析文件
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ConfigTab>('ai-config')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={processing} className="flex items-center gap-1">
          <Settings className="h-3.5 w-3.5" />
          {t('config.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[85vh] w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-wrap break-words">
            <Settings className="h-4 w-4 flex-shrink-0" />
            {t(TAB_TITLE_KEY[tab])}
          </DialogTitle>
          <DialogDescription className="text-wrap break-words">{t('config.description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as ConfigTab)} className="w-full">
            <TabsList className="flex flex-wrap w-full h-auto gap-1 p-1">
              <TabsTrigger value="ai-config" className="flex-1 min-w-fit">{t('config.aiServiceConfig')}</TabsTrigger>
              <TabsTrigger value="ai-providers" className="flex-1 min-w-fit">{t('config.tabs.providers')}</TabsTrigger>
              <TabsTrigger value="prompts" className="flex-1 min-w-fit">{t('promptEditor.title')}</TabsTrigger>
              <TabsTrigger value="webdav" className="flex-1 min-w-fit">{t('config.tabs.webdav')}</TabsTrigger>
              <TabsTrigger value="export-import" className="flex-1 min-w-fit">{t('config.tabs.exportImport')}</TabsTrigger>
            </TabsList>

            <TabsContent value="ai-config" className="space-y-3 mt-3">
              <AIServiceSection processing={processing} />
              <ProxySection processing={processing} />
              <RateLimitSection processing={processing} />
              <ProcessingSection processing={processing} />
              <ChapterSection processing={processing} />
              <ChapterPreview open={open} file={file} />
            </TabsContent>

            <TabsContent value="ai-providers" className="mt-4">
              <AIProviderConfig />
            </TabsContent>

            <TabsContent value="prompts" className="mt-4">
              <PromptEditor />
            </TabsContent>

            <TabsContent value="webdav" className="mt-4">
              <WebDAVConfig />
            </TabsContent>

            <TabsContent value="export-import" className="mt-4">
              <ConfigExportImport />
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export default ConfigDialog
