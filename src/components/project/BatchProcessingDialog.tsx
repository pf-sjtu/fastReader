// WebDAV 批量处理对话框：组合「配置」页（选文件 + 选项）与「队列」页
import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FolderOpen, Play, Pause, Square, Trash2, Settings, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { useProcessingOptions } from '../../stores/configStore'
import { useBatchQueueStore, useBatchProcessingStatus } from '../../stores/batchQueueStore'
import { useBatchFileSelection } from './batch/useBatchFileSelection'
import { useBatchQueueControls } from './batch/useBatchQueueControls'
import { BatchFileTab, type BatchOptions } from './batch/BatchFileTab'
import { BatchQueueTab } from './batch/BatchQueueTab'

interface BatchProcessingDialogProps {
  children?: React.ReactNode
  triggerVariant?: 'default' | 'outline' | 'ghost'
  triggerSize?: 'default' | 'sm' | 'lg' | 'icon'
}

export function BatchProcessingDialog({ children, triggerVariant = 'outline', triggerSize = 'sm' }: BatchProcessingDialogProps) {
  const { t } = useTranslation()
  const { queueLength, addToQueue, setConfig } = useBatchQueueStore(
    useShallow((s) => ({ queueLength: s.queue.length, addToQueue: s.addToQueue, setConfig: s.setConfig }))
  )
  const { isProcessing, isPaused } = useBatchProcessingStatus()
  const processingOptions = useProcessingOptions()
  const controls = useBatchQueueControls()

  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'config' | 'queue'>('config')
  const [options, setOptions] = useState<BatchOptions>({ maxFiles: 0, skipProcessed: true, order: 'sequential' })
  const selection = useBatchFileSelection(isOpen)
  const { selectedFiles, currentPath } = selection

  const handleStartBatch = async () => {
    if (selectedFiles.length === 0) {
      toast.error(t('batch.selectFilesTitle'), { description: t('batch.selectFilesDesc') })
      return
    }
    if (!controls.checkMode()) return

    setConfig({
      sourcePath: currentPath,
      maxFiles: options.maxFiles,
      skipProcessed: options.skipProcessed,
      order: options.order,
      bookType: processingOptions.bookType || 'non-fiction',
      processingMode: processingOptions.processingMode || 'summary',
      chapterDetectionMode: processingOptions.chapterDetectionMode || 'normal',
      outputLanguage: processingOptions.outputLanguage || 'auto',
      // 与全局「章节并行」一致：文件级与章级默认 max=3，可配置
      fileConcurrency: processingOptions.chapterConcurrency ?? 3,
      chapterConcurrency: processingOptions.chapterConcurrency ?? 3,
    })
    addToQueue(
      selectedFiles.map((file) => ({ fileName: file.basename, filePath: `${currentPath}${file.basename}`, selectedChapters: undefined }))
    )
    selection.clearSelection()
    setActiveTab('queue')
    // 与队列面板同一入口：确认云端缓存状态后才真正开始
    await controls.start()
  }

  const tabButton = (tab: 'config' | 'queue', Icon: typeof Settings, label: string, extra?: React.ReactNode) => (
    <Button variant={activeTab === tab ? 'secondary' : 'ghost'} className="rounded-b-none" onClick={() => setActiveTab(tab)}>
      <Icon className="h-4 w-4 mr-2" />
      {label}
      {extra}
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant={triggerVariant} size={triggerSize}>
            <FolderOpen className="h-4 w-4 mr-2" />
            {t('batch.trigger')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {t('batch.title')}
          </DialogTitle>
          <DialogDescription>{t('batch.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex border-b">
          {tabButton('config', Settings, t('batch.tabConfig'))}
          {tabButton(
            'queue',
            Clock,
            t('batch.tabQueue'),
            queueLength > 0 && (
              <Badge variant="secondary" className="ml-2">
                {queueLength}
              </Badge>
            )
          )}
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === 'config' ? (
            <BatchFileTab selection={selection} options={options} onOptionsChange={(p) => setOptions((o) => ({ ...o, ...p }))} />
          ) : (
            <BatchQueueTab onClearQueue={controls.clear} />
          )}
        </div>

        <DialogFooter className="flex-shrink-0">
          {activeTab === 'config' ? (
            <>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleStartBatch()} disabled={selectedFiles.length === 0 || isProcessing}>
                <Play className="h-4 w-4 mr-2" />
                {t('batch.startBatch', { count: selectedFiles.length })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={controls.clear} disabled={queueLength === 0}>
                <Trash2 className="h-4 w-4 mr-2" />
                {t('batch.clearQueue')}
              </Button>
              {isProcessing ? (
                <>
                  <Button variant="outline" onClick={controls.togglePause}>
                    {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                    {isPaused ? t('batch.resume') : t('batch.pause')}
                  </Button>
                  <Button variant="destructive" onClick={controls.stop}>
                    <Square className="h-4 w-4 mr-2" />
                    {t('batch.stop')}
                  </Button>
                </>
              ) : (
                <Button onClick={() => void controls.start()} disabled={queueLength === 0}>
                  <Play className="h-4 w-4 mr-2" />
                  {t('batch.startProcessing')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BatchProcessingDialog
