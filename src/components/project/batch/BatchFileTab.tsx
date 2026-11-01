// 批量处理「配置」页：目录导航、文件多选、处理选项
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, RefreshCw, CheckCircle, XCircle, FileText, Book, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatFileSize } from '../../../utils/file'
import { extOf } from '../webdav/fileListUtils'
import { isBatchBook, type useBatchFileSelection } from './useBatchFileSelection'

export interface BatchOptions {
  maxFiles: number
  skipProcessed: boolean
  order: 'sequential' | 'random'
}

interface BatchFileTabProps {
  selection: ReturnType<typeof useBatchFileSelection>
  options: BatchOptions
  onOptionsChange: (patch: Partial<BatchOptions>) => void
}

const MAX_FILE_CHOICES = [5, 10, 20, 50]

export function BatchFileTab({ selection: sel, options, onOptionsChange }: BatchFileTabProps) {
  const { t } = useTranslation()
  const entries = sel.files.filter((f) => f.type === 'directory' || isBatchBook(f))
  const bookCount = entries.filter((f) => f.type === 'file').length

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="h-full flex flex-col space-y-4 pr-4">
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={sel.navigateUp} disabled={sel.currentPath === '/'}>
            <ChevronUp className="h-4 w-4" />
            {t('webdav.browser.up')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void sel.loadDirectory(sel.currentPath)} disabled={sel.isLoadingFiles}>
            <RefreshCw className={`h-4 w-4 ${sel.isLoadingFiles ? 'animate-spin' : ''}`} />
            {t('webdav.browser.refresh')}
          </Button>
          <span className="text-sm text-muted-foreground truncate min-w-0 flex-1 basis-40" title={sel.currentPath}>
            {sel.currentPath}
          </span>
        </div>

        {sel.error && (
          <Alert variant="destructive" className="flex-shrink-0">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{sel.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border rounded-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b bg-muted/50">
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={sel.selectedFiles.length === bookCount}
                onCheckedChange={(checked) => (checked ? sel.selectAll(options.skipProcessed) : sel.clearSelection())}
              />
              <Label htmlFor="select-all" className="text-sm">
                {t('batch.selectAll', { count: bookCount })}
              </Label>
            </div>
            {sel.isCheckingCache && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('batch.checkingCache')}
              </span>
            )}
          </div>
          <ScrollArea className="flex-1">
            {sel.isLoadingFiles ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">{t('common.loading')}</span>
              </div>
            ) : entries.length === 0 ? (
              <EmptyState icon={FolderOpen} title={t('webdav.emptyDirectory')} className="py-8" />
            ) : (
              // 窄屏下行内容过宽时在此横向滚动（外层 ScrollArea 仅纵向）
              <div className="overflow-x-auto">
                <div className="min-w-[18rem]" role="group" aria-label={sel.currentPath}>
                  {entries.map((file) => {
                    const isDirectory = file.type === 'directory'
                    const isSelected = sel.selectedFiles.some((f) => f.basename === file.basename)
                    const cached = isDirectory ? undefined : sel.hasCache(file)
                    return (
                      <div
                        key={file.filename}
                        // 书籍行是可勾选项；目录行是进入子目录的按钮
                        role={isDirectory ? 'button' : 'checkbox'}
                        aria-checked={isDirectory ? undefined : isSelected}
                        tabIndex={0}
                        className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isSelected ? 'bg-accent' : ''}`}
                        onClick={() => sel.toggleEntry(file)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            sel.toggleEntry(file)
                          }
                        }}
                      >
                        {isDirectory ? (
                          // 占位保持图标列对齐
                          <span className="size-4 shrink-0" aria-hidden="true" />
                        ) : (
                          // 纯视觉勾选框：交互与语义由整行承担，避免嵌套可聚焦控件
                          <Checkbox
                            checked={isSelected}
                            tabIndex={-1}
                            aria-hidden="true"
                            className="pointer-events-none"
                          />
                        )}
                        {isDirectory ? (
                          <FolderOpen className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                        ) : extOf(file.basename) === '.pdf' ? (
                          <Book className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                        ) : (
                          <FileText className="h-4 w-4 text-info shrink-0" aria-hidden="true" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate" title={file.basename}>
                            {file.basename}
                          </div>
                          {!isDirectory && <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>}
                        </div>
                        {cached === true && (
                          <Badge variant="outline" className="text-success border-success/40 shrink-0">
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            {t('batch.cached')}
                          </Badge>
                        )}
                        {cached === false && options.skipProcessed && (
                          <Badge variant="secondary" className="text-warning shrink-0">
                            {t('batch.unprocessed')}
                          </Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 sm:p-4 bg-muted/50 rounded-lg border flex-shrink-0">
          <div className="space-y-2">
            <Label htmlFor="batch-max-files">{t('batch.range')}</Label>
            <Select
              value={options.maxFiles === 0 ? 'all' : String(options.maxFiles)}
              onValueChange={(v) => onOptionsChange({ maxFiles: v === 'all' ? 0 : parseInt(v, 10) })}
            >
              <SelectTrigger id="batch-max-files">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('batch.rangeAll')}</SelectItem>
                {MAX_FILE_CHOICES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t('batch.rangeFirst', { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('batch.rangeHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-order">{t('batch.order')}</Label>
            <Select value={options.order} onValueChange={(v: BatchOptions['order']) => onOptionsChange({ order: v })}>
              <SelectTrigger id="batch-order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">{t('batch.orderSequential')}</SelectItem>
                <SelectItem value="random">{t('batch.orderRandom')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('batch.orderHint')}</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="batch-skip-processed">{t('batch.skipProcessed')}</Label>
              <p className="text-xs text-muted-foreground">{t('batch.skipProcessedHint')}</p>
            </div>
            <Switch
              id="batch-skip-processed"
              checked={options.skipProcessed}
              onCheckedChange={(v) => onOptionsChange({ skipProcessed: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('batch.currentSelection')}</Label>
              <p className="text-xs text-muted-foreground">{t('batch.currentSelectionHint')}</p>
            </div>
            <Badge variant="secondary" className="text-lg px-3">
              {t('batch.fileCount', { count: sel.selectedFiles.length })}
            </Badge>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
