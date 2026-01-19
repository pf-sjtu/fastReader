import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  FolderOpen,
  Play,
  Pause,
  Square,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  FileText,
  Book,
  ChevronDown,
  ChevronUp,
  Settings,
  Clock
} from 'lucide-react'
import { useWebDAVConfig, useProcessingOptions } from '../../stores/configStore'
import { webdavService, type WebDAVFileInfo } from '../../services/webdavService'
import { normalizeDavPath } from '../../services/webdavProxyUtils'

import { cloudCacheService } from '../../services/cloudCacheService'
import { batchProcessingEngine } from '../../services/batchProcessingEngine'
import { useBatchQueueStore, useBatchProcessingStatus, useBatchStats, type BatchQueueItem } from '../../stores/batchQueueStore'
import { toast } from 'sonner'


interface BatchProcessingDialogProps {
  children?: React.ReactNode
  triggerVariant?: 'default' | 'outline' | 'ghost'
  triggerSize?: 'default' | 'sm' | 'lg' | 'icon'
}

export function BatchProcessingDialog({
  children,
  triggerVariant = 'outline',
  triggerSize = 'sm'
}: BatchProcessingDialogProps) {
  // Store
  const { queue, addToQueue, clearQueue, startProcessing, pauseProcessing, resumeProcessing, stopProcessing, setConfig } = useBatchQueueStore()
  const { isProcessing, isPaused, currentItem } = useBatchProcessingStatus()
  const stats = useBatchStats()

  // Config
  const webdavConfig = useWebDAVConfig()
  const processingOptions = useProcessingOptions()

  // Dialog state
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'config' | 'queue'>('config')

  // Folder selection state
  const [currentPath, setCurrentPath] = useState('/')
  const [files, setFiles] = useState<WebDAVFileInfo[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Batch config state
  const [maxFiles, setMaxFiles] = useState<number>(0)
  const [skipProcessed, setSkipProcessed] = useState(true)
  const [processingOrder, setProcessingOrder] = useState<'sequential' | 'random'>('sequential')
  const [selectedFiles, setSelectedFiles] = useState<WebDAVFileInfo[]>([])
  const [isCheckingCache, setIsCheckingCache] = useState(false)
  const [cacheStatusMap, setCacheStatusMap] = useState<Map<string, boolean>>(new Map())
  const [cachedFileNames, setCachedFileNames] = useState<Set<string>>(new Set())


  // Queue preview state
  const [queueExpanded, setQueueExpanded] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)

  // File extensions to include
  const allowedExtensions = ['.epub', '.pdf']

  // Initialize WebDAV and load files
  useEffect(() => {
    if (!isOpen) return

    const initialize = async () => {
      if (!webdavService.isInitialized()) {
        if (!webdavConfig.enabled || !webdavConfig.serverUrl || !webdavConfig.username || !webdavConfig.password) {
          setError('WebDAV配置不完整，请先完成配置')
          return
        }

        const initResult = await webdavService.initialize(webdavConfig)
        if (!initResult.success) {
          setError(`WebDAV初始化失败: ${initResult.error}`)
          return
        }
      }

      setIsInitialized(true)
      loadDirectory(currentPath)
    }

    initialize()
  }, [isOpen, webdavConfig])

  // Load directory when path changes
  useEffect(() => {
    if (isOpen && isInitialized) {
      loadDirectory(currentPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, isOpen, isInitialized])

  // Load directory
  const loadDirectory = async (path: string) => {
    setIsLoadingFiles(true)
    setError(null)

    try {
      const result = await webdavService.getDirectoryContents(path)
      if (result.success && result.data) {
        setFiles(result.data)
        setCurrentPath(path)
      } else {
        setError(result.error || '加载目录失败')
        setFiles([])
      }
    } catch (err) {
      setError(`加载目录异常: ${err instanceof Error ? err.message : '未知错误'}`)
      setFiles([])
    } finally {
      setIsLoadingFiles(false)
    }
  }

  // Navigate to folder
  const navigateToFolder = (folder: WebDAVFileInfo) => {
    let newPath = normalizeDavPath(folder.filename)
    if (!newPath.endsWith('/')) newPath += '/'
    setCurrentPath(newPath)

  }

  // Navigate up
  const navigateUp = () => {
    if (currentPath === '/' || currentPath === '') return
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/') + '/'
    setCurrentPath(parentPath)
  }

  // Check cache status for files
  const checkCacheStatus = async (filesToCheck: WebDAVFileInfo[]) => {
    setIsCheckingCache(true)
    const statusMap = new Map<string, boolean>()

    const cachedNames = await cloudCacheService.fetchCacheFileNames()

    for (const file of filesToCheck) {
      if (file.type === 'file') {
        statusMap.set(file.basename, cloudCacheService.isCachedByFileName(file.basename, cachedNames))
      }
    }

    setCachedFileNames(cachedNames)
    setCacheStatusMap(statusMap)
    setIsCheckingCache(false)
  }


  // Handle file selection
  const handleFileSelect = (file: WebDAVFileInfo) => {
    if (file.type === 'directory') {
      navigateToFolder(file)
      return
    }

    const extension = '.' + file.basename.toLowerCase().split('.').pop()
    if (!allowedExtensions.includes(extension)) return

    setSelectedFiles(prev => {
      const exists = prev.find(f => f.basename === file.basename)
      if (exists) {
        return prev.filter(f => f.basename !== file.basename)
      }
      return [...prev, file]
    })
  }

  // Handle select all matching files
  const handleSelectAll = () => {
    const matchingFiles = files.filter(file => {
      if (file.type === 'directory') return false
      const extension = '.' + file.basename.toLowerCase().split('.').pop()
      return allowedExtensions.includes(extension)
    })

    // Filter based on cache status if skipProcessed is true
    if (skipProcessed) {
      const unprocessed = matchingFiles.filter(file => !cloudCacheService.isCachedByFileName(file.basename, cachedFileNames))
      setSelectedFiles(unprocessed)
    } else {
      setSelectedFiles(matchingFiles)
    }
  }


  // Handle clear selection
  const handleClearSelection = () => {
    setSelectedFiles([])
  }

  // Start batch processing
  const handleStartBatch = async () => {
    if (selectedFiles.length === 0) {
      toast.error('请选择文件', {
        description: '请至少选择一个要处理的文件'
      })
      return
    }

    // Prepare items
    const items = selectedFiles.map(file => ({
      fileName: file.basename,
      filePath: `${currentPath}${file.basename}`,
      selectedChapters: undefined
    }))

    // Set config
    setConfig({
      sourcePath: currentPath,
      maxFiles: maxFiles,
      skipProcessed,
      order: processingOrder,
      bookType: processingOptions.bookType || 'non-fiction',
      processingMode: processingOptions.processingMode || 'summary',
      chapterDetectionMode: processingOptions.chapterDetectionMode || 'normal',
      outputLanguage: processingOptions.outputLanguage || 'auto'
    })

    // Add to queue
    addToQueue(items)

    // Clear selection and switch to queue tab
    setSelectedFiles([])
    setActiveTab('queue')

    // Start processing
    startProcessing()

    toast('开始批量处理', {
      description: `已将 ${items.length} 个文件添加到处理队列`
    })
  }

  // Handle pause/resume
  const handleTogglePause = () => {
    if (isPaused) {
      resumeProcessing()
      toast('已继续处理', {
        description: '批量处理已继续'
      })
    } else {
      pauseProcessing()
      toast('已暂停处理', {
        description: '批量处理已暂停'
      })
    }
  }

  // Handle stop
  const handleStop = () => {
    stopProcessing()
    toast('已停止处理', {
      description: '批量处理已停止'
    })
  }

  // Handle clear queue
  const handleClearQueue = () => {
    batchProcessingEngine.stop()
    stopProcessing()
    clearQueue()
    toast('已清空队列', {
      description: '批量处理队列已清空'
    })
  }


  // Filter and sort files
  const filteredFiles = files.filter(file => {
    if (file.type === 'directory') return true
    const extension = '.' + file.basename.toLowerCase().split('.').pop()
    return allowedExtensions.includes(extension)
  })

  // Get status badge
  const getStatusBadge = (status: BatchQueueItem['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">等待中</Badge>
      case 'processing':
        return <Badge variant="default" className="bg-blue-500">处理中</Badge>
      case 'completed':
        return <Badge variant="default" className="bg-green-500">完成</Badge>
      case 'failed':
        return <Badge variant="destructive">失败</Badge>
      case 'skipped':
        return <Badge variant="outline">跳过</Badge>
    }
  }

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Check cache when files are loaded
  useEffect(() => {
    if (files.length > 0 && isOpen) {
      checkCacheStatus(files.filter(f => f.type === 'file'))
    } else if (files.length === 0) {
      setCachedFileNames(new Set())
      setCacheStatusMap(new Map())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, isOpen])


  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant={triggerVariant} size={triggerSize}>
            <FolderOpen className="h-4 w-4 mr-2" />
            批量处理
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            WebDAV 批量处理
          </DialogTitle>
          <DialogDescription>
            从 WebDAV 文件夹批量导入和处理电子书文件
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex border-b">
          <Button
            variant={activeTab === 'config' ? 'secondary' : 'ghost'}
            className="rounded-b-none"
            onClick={() => setActiveTab('config')}
          >
            <Settings className="h-4 w-4 mr-2" />
            配置
          </Button>
          <Button
            variant={activeTab === 'queue' ? 'secondary' : 'ghost'}
            className="rounded-b-none"
            onClick={() => setActiveTab('queue')}
          >
            <Clock className="h-4 w-4 mr-2" />
            队列
            {queue.length > 0 && (
              <Badge variant="secondary" className="ml-2">{queue.length}</Badge>
            )}
          </Button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'config' ? (
            <div className="h-full flex flex-col space-y-4 overflow-hidden">
              {/* Folder navigation */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={navigateUp} disabled={currentPath === '/'}>
                  <ChevronUp className="h-4 w-4" />
                  上级
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadDirectory(currentPath)} disabled={isLoadingFiles}>
                  <RefreshCw className={`h-4 w-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
                <span className="text-sm text-muted-foreground truncate">
                  {currentPath}
                </span>
              </div>

              {/* Error alert */}
              {error && (
                <Alert variant="destructive" className="flex-shrink-0">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* File list */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden border rounded-lg">
                <div className="flex items-center justify-between p-2 border-b bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all"
                      checked={selectedFiles.length === filteredFiles.filter(f => f.type === 'file').length}
                      onCheckedChange={(checked) => {
                        if (checked) handleSelectAll()
                        else handleClearSelection()
                      }}
                    />
                    <Label htmlFor="select-all" className="text-sm">
                      全选 ({filteredFiles.filter(f => f.type === 'file').length} 个文件)
                    </Label>
                  </div>
                  {isCheckingCache && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      检查缓存状态...
                    </span>
                  )}
                </div>
                <ScrollArea className="flex-1">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="ml-2">加载中...</span>
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      目录为空
                    </div>
                  ) : (
                    <div className="min-w-[600px]">
                      {filteredFiles.map((file, index) => {
                        const isSelected = selectedFiles.some(f => f.basename === file.basename)
                        const hasCache = cacheStatusMap.get(file.basename)
                        const extension = file.basename.toLowerCase().split('.').pop()

                        return (
                          <div
                            key={index}
                            className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b ${
                              isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                            onClick={() => handleFileSelect(file)}
                          >
                            <Checkbox checked={isSelected} />

                            {file.type === 'directory' ? (
                              <FolderOpen className="h-4 w-4 text-blue-500" />
                            ) : (
                              <>
                                {extension === 'pdf' ? (
                                  <Book className="h-4 w-4 text-red-500" />
                                ) : (
                                  <FileText className="h-4 w-4 text-purple-500" />
                                )}
                              </>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{file.basename}</div>
                              {file.type === 'file' && (
                                <div className="text-xs text-muted-foreground">
                                  {formatFileSize(file.size)}
                                </div>
                              )}
                            </div>

                            {file.type === 'file' && (
                              <div className="flex items-center gap-2">
                                {hasCache === true && (
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    已缓存
                                  </Badge>
                                )}
                                {hasCache === false && skipProcessed && (
                                  <Badge variant="secondary" className="text-orange-600">
                                    未处理
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* Batch options */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg border flex-shrink-0">
                <div className="space-y-2">
                  <Label>处理范围</Label>
                  <Select
                    value={maxFiles === 0 ? 'all' : maxFiles.toString()}
                    onValueChange={(value) => setMaxFiles(value === 'all' ? 0 : parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部文件</SelectItem>
                      <SelectItem value="5">前 5 个</SelectItem>
                      <SelectItem value="10">前 10 个</SelectItem>
                      <SelectItem value="20">前 20 个</SelectItem>
                      <SelectItem value="50">前 50 个</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    选择要处理的文件数量，0 表示处理所有选中文件
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>处理顺序</Label>
                  <Select
                    value={processingOrder}
                    onValueChange={(value: 'sequential' | 'random') => setProcessingOrder(value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">顺序处理</SelectItem>
                      <SelectItem value="random">随机顺序</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    文件的处理顺序
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>跳过已处理</Label>
                    <p className="text-xs text-muted-foreground">
                      跳过 WebDAV 中已有缓存的文件
                    </p>
                  </div>
                  <Switch checked={skipProcessed} onCheckedChange={setSkipProcessed} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>当前选中</Label>
                    <p className="text-xs text-muted-foreground">
                      将要添加到队列的文件
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-lg px-3">
                    {selectedFiles.length} 个文件
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col space-y-4 overflow-hidden">
              {/* Stats bar */}
              <div className="grid grid-cols-5 gap-2 p-3 bg-muted/50 rounded-lg flex-shrink-0">
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">总计</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-500">{stats.completed}</div>
                  <div className="text-xs text-muted-foreground">完成</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">{stats.failed}</div>
                  <div className="text-xs text-muted-foreground">失败</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-500">{stats.skipped}</div>
                  <div className="text-xs text-muted-foreground">跳过</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-500">¥{(stats.totalCostRMB || 0).toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">成本</div>
                </div>
              </div>

              {/* Progress bar */}
              {isProcessing && (
                <div className="space-y-2 flex-shrink-0">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {isPaused ? '已暂停' : '处理中'}
                      {currentItem && ` - ${currentItem.fileName}`}
                    </span>
                    <span>
                      {stats.completed}/{stats.total}
                    </span>
                  </div>
                  <Progress
                    value={(stats.completed / (stats.total || 1)) * 100}
                    className="h-2"
                  />
                </div>
              )}

              {/* Queue list */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden border rounded-lg">
                <div className="flex items-center justify-between p-2 border-b bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQueueExpanded(!queueExpanded)}
                    >
                      {queueExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                    <span className="text-sm font-medium">
                      处理队列 ({queue.length} 项)
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleClearQueue} disabled={queue.length === 0}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    清空
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  {queue.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      队列为空，请在配置页面添加文件
                    </div>
                  ) : (
                    <div className="min-w-[600px]">
                      {queue.map((item, index) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 border-b ${
                            item.status === 'processing' ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <span className="w-6 text-xs text-muted-foreground">{index + 1}.</span>
                          {getStatusBadge(item.status)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{item.fileName}</div>
                            {item.error && (
                              <div className="text-xs text-red-500 truncate">{item.error}</div>
                            )}
                            {item.metadata && (
                              <div className="text-xs text-muted-foreground">
                                {item.metadata.chapterCount} 章节
                                {item.metadata.costRMB && ` • ¥${item.metadata.costRMB.toFixed(2)}`}
                              </div>
                            )}
                          </div>
                          {item.status === 'processing' && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          )}
                          {item.status === 'completed' && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                          {item.status === 'failed' && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-shrink-0">
          {activeTab === 'config' ? (
            <>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleStartBatch}
                disabled={selectedFiles.length === 0 || isProcessing}
              >
                <Play className="h-4 w-4 mr-2" />
                开始批量处理 ({selectedFiles.length})
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClearQueue} disabled={queue.length === 0}>
                <Trash2 className="h-4 w-4 mr-2" />
                清空队列
              </Button>
              {isProcessing ? (
                <>
                  <Button variant="outline" onClick={handleTogglePause}>
                    {isPaused ? (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        继续
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        暂停
                      </>
                    )}
                  </Button>
                  <Button variant="destructive" onClick={handleStop}>
                    <Square className="h-4 w-4 mr-2" />
                    停止
                  </Button>
                </>
              ) : (
                <Button onClick={startProcessing} disabled={queue.length === 0}>
                  <Play className="h-4 w-4 mr-2" />
                  开始处理
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
