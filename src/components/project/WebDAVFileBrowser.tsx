import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FolderOpen,
  Download,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  Book,
  RefreshCw,
  File,
  ArrowUp,
  ArrowDown,
  Shuffle,
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { webdavService, type WebDAVFileInfo } from '../../services/webdavService'
import { formatFileSize } from '../../utils/file'
import { useWebDAVClient } from './webdav/useWebDAVClient'
import { directoryPath, extOf, filterEntries, parentPath, sortEntries, type SortBy, type SortOrder } from './webdav/fileListUtils'

interface WebDAVFileBrowserProps {
  isOpen: boolean
  onClose: () => void
  onFileSelect: (file: File) => void
  allowedExtensions?: string[]
}

const DEFAULT_EXTENSIONS = ['.epub', '.pdf', '.txt', '.md']

function FileIcon({ file }: { file: WebDAVFileInfo }) {
  if (file.type === 'directory') return <FolderOpen className="h-4 w-4 text-primary" />
  switch (extOf(file.basename)) {
    case '.pdf':
      return <FileText className="h-4 w-4 text-red-500" />
    case '.epub':
      return <Book className="h-4 w-4 text-purple-500" />
    case '.md':
    case '.txt':
      return <FileText className="h-4 w-4 text-muted-foreground" />
    default:
      return <File className="h-4 w-4 text-muted-foreground/70" />
  }
}

const formatDate = (s: string) => new Date(s).toLocaleString()

export function WebDAVFileBrowser({ isOpen, onClose, onFileSelect, allowedExtensions = DEFAULT_EXTENSIONS }: WebDAVFileBrowserProps) {
  const { t } = useTranslation()
  const { config, listDirectory } = useWebDAVClient()
  const startPath = config.browsePath || '/'

  const [currentPath, setCurrentPath] = useState(startPath)
  const [pathHistory, setPathHistory] = useState<string[]>([startPath])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [files, setFiles] = useState<WebDAVFileInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<WebDAVFileInfo | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  // 只采纳最后一次列目录的结果（快速切换目录时旧响应晚到不覆盖）
  const loadSeqRef = useRef(0)

  // 设置里的浏览路径变化 → 回到新起点（渲染期调整状态，避免 effect 里 setState 的级联渲染）
  const [prevStartPath, setPrevStartPath] = useState(startPath)
  if (startPath !== prevStartPath) {
    setPrevStartPath(startPath)
    setCurrentPath(startPath)
    setPathHistory([startPath])
    setHistoryIndex(0)
  }

  const loadDirectory = useCallback(
    async (path: string) => {
      const seq = ++loadSeqRef.current
      setIsLoading(true)
      setError(null)
      const r = await listDirectory(path)
      if (seq !== loadSeqRef.current) return
      if (r.ok) setFiles(r.files)
      else {
        setError(r.error)
        setFiles([])
      }
      setIsLoading(false)
    },
    [listDirectory]
  )

  // 打开或路径变化时加载（listDirectory 内部按需初始化 WebDAV）
  useEffect(() => {
    if (isOpen) void loadDirectory(currentPath)
  }, [isOpen, currentPath, loadDirectory])

  const goTo = (path: string) => {
    const next = [...pathHistory.slice(0, historyIndex + 1), path]
    setPathHistory(next)
    setHistoryIndex(next.length - 1)
    setCurrentPath(path)
  }

  const goHistory = (delta: number) => {
    const i = historyIndex + delta
    if (i < 0 || i >= pathHistory.length) return
    setHistoryIndex(i)
    setCurrentPath(pathHistory[i])
  }

  const navigateUp = () => {
    const parent = parentPath(currentPath)
    if (parent !== null) goTo(parent)
  }

  // 行点击 / Enter / Space：目录进入，文件选中
  const activateEntry = (file: WebDAVFileInfo) => {
    if (file.type === 'directory') goTo(directoryPath(file))
    else setSelectedFile(file)
  }

  /** 下载为 File；失败时写入错误并返回 null */
  const fetchFile = async (target: WebDAVFileInfo, failKey: string): Promise<globalThis.File | null> => {
    setIsDownloading(true)
    try {
      // 传递文件名以避免特殊字符问题
      const r = await webdavService.downloadFileAsFile(target.filename, target.basename)
      if (!r.success || !r.data) {
        setError(r.error || t('webdav.browser.downloadFailed'))
        return null
      }
      return r.data
    } catch {
      setError(t(failKey))
      return null
    } finally {
      setIsDownloading(false)
    }
  }

  // target 显式传入：行内下载按钮 setSelectedFile 后 state 尚未更新，不能读闭包里的 selectedFile
  const handleDownloadFile = async (target: WebDAVFileInfo) => {
    const data = await fetchFile(target, 'webdav.browser.downloadFailed')
    if (!data) return
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = target.basename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleFileSelect = async () => {
    if (!selectedFile) return
    const data = await fetchFile(selectedFile, 'webdav.browser.selectFailed')
    if (!data) return
    onFileSelect(data)
    onClose()
  }

  const entries = useMemo(
    () => sortEntries(filterEntries(files, searchQuery, allowedExtensions), sortBy, sortOrder, shuffleSeed),
    [files, searchQuery, allowedExtensions, sortBy, sortOrder, shuffleSeed]
  )
  const isSelectable = (f: WebDAVFileInfo) => f.type === 'file' && allowedExtensions.includes(extOf(f.basename))

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {t('webdav.browser.title')}
          </DialogTitle>
          <DialogDescription>{t('webdav.browser.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 space-y-3 overflow-hidden">
          {/* 窄屏换行：导航按钮一行，搜索框占满下一行 */}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => goHistory(-1)} disabled={historyIndex <= 0} aria-label={t('webdav.browser.back')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goHistory(1)}
                disabled={historyIndex >= pathHistory.length - 1}
                aria-label={t('webdav.browser.forward')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={navigateUp} disabled={parentPath(currentPath) === null}>
                <ChevronUp className="h-4 w-4" />
                {t('webdav.browser.up')}
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDirectory(currentPath)}
              disabled={isLoading}
              aria-label={t('webdav.browser.refresh')}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>

            <div className="order-last basis-full sm:order-none sm:basis-auto flex-1 min-w-0 sm:max-w-md">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('webdav.browser.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={(v: SortBy) => setSortBy(v)}>
                <SelectTrigger className="w-32" aria-label={t('webdav.browser.sortBy')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">{t('webdav.browser.sortName')}</SelectItem>
                  <SelectItem value="time">{t('webdav.browser.sortTime')}</SelectItem>
                  <SelectItem value="random">{t('webdav.browser.sortRandom')}</SelectItem>
                </SelectContent>
              </Select>

              {sortBy === 'random' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShuffleSeed((n) => n + 1)}
                  className="w-10 p-0"
                  title={t('webdav.browser.reshuffle')}
                  aria-label={t('webdav.browser.reshuffle')}
                >
                  <Shuffle className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="w-10 p-0"
                  aria-label={t('webdav.browser.toggleOrder')}
                >
                  {sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
            <FolderOpen className="h-4 w-4" />
            <span className="truncate" title={currentPath}>
              {t('webdav.browser.currentPath', { path: currentPath })}
            </span>
          </div>

          {error && (
            <Alert className="border-red-200 flex-shrink-0">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-full w-full">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="ml-2">{t('common.loading')}</span>
                    </div>
                  ) : entries.length === 0 ? (
                    <EmptyState
                      icon={searchQuery ? Search : FolderOpen}
                      title={searchQuery ? t('webdav.noSearchResults') : t('webdav.emptyDirectory')}
                      description={searchQuery ? t('webdav.tryDifferentSearch') : t('webdav.emptyDirectoryDesc')}
                    />
                  ) : (
                    // 窄屏下行内容过宽时在此横向滚动（外层 ScrollArea 仅纵向）
                    <div className="overflow-x-auto">
                      <div className="min-w-[18rem]">
                        {entries.map((file) => (
                          <div
                            key={file.filename}
                            role="button"
                            tabIndex={0}
                            aria-pressed={file.type === 'file' ? selectedFile?.filename === file.filename : undefined}
                            className={`flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              selectedFile?.filename === file.filename ? 'bg-accent' : ''
                            }`}
                            onClick={() => activateEntry(file)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                              // 只响应行本身（行内下载按钮自带键盘行为）
                              if (e.target !== e.currentTarget) return
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                activateEntry(file)
                              }
                            }}
                          >
                            <FileIcon file={file} />
                            <div className="flex-1 min-w-0 flex-shrink-0">
                              <div className="font-medium text-sm truncate" title={file.basename}>
                                {file.basename}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {file.type === 'directory' ? t('webdav.browser.directory') : formatFileSize(file.size)}
                                {file.type === 'file' && ` • ${formatDate(file.lastmod)}`}
                              </div>
                            </div>
                            {isSelectable(file) && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 ml-2" />}
                            {file.type === 'file' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-8 h-8 p-0 flex-shrink-0 ml-1"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation()
                                  setSelectedFile(file)
                                  void handleDownloadFile(file)
                                }}
                                title={t('webdav.browser.downloadFile')}
                                aria-label={t('webdav.browser.downloadFileNamed', { name: file.basename })}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {selectedFile && selectedFile.type === 'file' && (
            <div className="flex-shrink-0 px-3 py-1.5 bg-muted rounded-md">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground min-w-0 truncate" title={selectedFile.basename}>
                  {selectedFile.basename.length > 30 ? selectedFile.basename.substring(0, 30) + '...' : selectedFile.basename}
                </span>
                <span>{t('webdav.browser.size', { size: formatFileSize(selectedFile.size) })}</span>
                <span>{t('webdav.browser.modified', { time: formatDate(selectedFile.lastmod) })}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:items-center flex-shrink-0">
            <div className="text-sm text-muted-foreground truncate min-w-0">
              {t('webdav.browser.supportedFormats', { formats: allowedExtensions.join(', ') })}
            </div>
            <div className="flex gap-2 justify-end shrink-0">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleFileSelect()} disabled={!selectedFile || selectedFile.type === 'directory' || isDownloading}>
                {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {isDownloading ? t('webdav.browser.downloading') : t('webdav.browser.selectFile')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
