import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FolderOpen,
  Download,
  Search,
  Filter,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
  FileText,
  Book,
  FileText as FilePdf,
  RefreshCw,
  File,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Shuffle
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useWebDAVConfig } from '../../stores/configStore'
import { webdavService, type WebDAVFileInfo } from '../../services/webdavService'
import { normalizeDavPath } from '../../services/webdavProxyUtils'

import { useTranslation } from 'react-i18next'

interface WebDAVFileBrowserProps {
  isOpen: boolean
  onClose: () => void
  onFileSelect: (file: File) => void
  allowedExtensions?: string[]
}

export function WebDAVFileBrowser({ 
  isOpen, 
  onClose, 
  onFileSelect,
  allowedExtensions = ['.epub', '.pdf', '.txt', '.md']
}: WebDAVFileBrowserProps) {
  const { t } = useTranslation()
  const webdavConfig = useWebDAVConfig()

  // 组件状态
  const [currentPath, setCurrentPath] = useState(webdavConfig.browsePath || '/')

  const [files, setFiles] = useState<WebDAVFileInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<WebDAVFileInfo | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>(['/'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [hasAttemptedInit, setHasAttemptedInit] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'time' | 'random'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // 检查并初始化WebDAV连接
  useEffect(() => {
    const initializeIfNeeded = async () => {
      // 如果已经初始化，直接加载根目录
      if (webdavService.isInitialized()) {
        if (isOpen && files.length === 0) {
          loadDirectory(webdavConfig.browsePath || '/')
        }

        return
      }

      // 如果WebDAV已启用且配置完整但未初始化，尝试初始化
      if (webdavConfig.enabled && 
          webdavConfig.serverUrl && 
          webdavConfig.username && 
          webdavConfig.password &&
          !hasAttemptedInit) {
        
        setHasAttemptedInit(true)
        console.log('WebDAVFileBrowser: 尝试初始化WebDAV服务...')
        
        try {
          const initResult = await webdavService.initialize(webdavConfig)
          if (initResult.success) {
            console.log('WebDAVFileBrowser: 初始化成功，加载根目录')
            if (isOpen) {
              loadDirectory(webdavConfig.browsePath || '/')
            }
          } else {

            console.error('WebDAVFileBrowser: 初始化失败:', initResult.error)
            setError(`WebDAV初始化失败: ${initResult.error}`)
          }
        } catch (error) {
          console.error('WebDAVFileBrowser: 初始化异常:', error)
          setError(`WebDAV初始化异常: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      } else if (!webdavConfig.enabled) {
        setError('WebDAV功能未启用，请在设置中启用并配置连接')
      } else if (!webdavConfig.serverUrl || !webdavConfig.username || !webdavConfig.password) {
        setError('WebDAV配置不完整，请完成配置')
      }
    }

    if (isOpen) {
      initializeIfNeeded()
    }
  }, [isOpen, webdavConfig, hasAttemptedInit, files.length])

  // 路径变化时加载目录
  useEffect(() => {
    if (isOpen && webdavService.isInitialized()) {
      loadDirectory(currentPath)
    }
  }, [currentPath, isOpen])

  useEffect(() => {
    if (webdavConfig.browsePath && webdavConfig.browsePath !== currentPath) {
      setCurrentPath(webdavConfig.browsePath)
    }
  }, [webdavConfig.browsePath])


  // 文件类型图标映射
  const getFileIcon = (file: WebDAVFileInfo) => {
    if (file.type === 'directory') {
      return <FolderOpen className="h-4 w-4 text-blue-500" />
    }
    
    const extension = file.basename.toLowerCase().split('.').pop()
    switch (extension) {
      case 'pdf':
        return <FilePdf className="h-4 w-4 text-red-500" />
      case 'epub':
        return <Book className="h-4 w-4 text-purple-500" />
      case 'md':
      case 'txt':
        return <FileText className="h-4 w-4 text-gray-500" />
      default:
        return <File className="h-4 w-4 text-gray-400" />
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 格式化时间
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  // 加载目录内容
  const loadDirectory = async (path: string) => {
    // 检查WebDAV服务是否已初始化
    if (!webdavService.isInitialized()) {
      console.log('WebDAV服务未初始化，尝试重新初始化...')
      
      if (!webdavConfig.enabled || !webdavConfig.serverUrl || !webdavConfig.username || !webdavConfig.password) {
        setError('WebDAV配置不完整，请先完成配置')
        return
      }

      try {
        const initResult = await webdavService.initialize(webdavConfig)
        if (!initResult.success) {
          setError(`WebDAV初始化失败: ${initResult.error}`)
          return
        }
      } catch (error) {
        setError(`WebDAV初始化异常: ${error instanceof Error ? error.message : '未知错误'}`)
        return
      }
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log('WebDAVFileBrowser: 加载目录:', path)
      const result = await webdavService.getDirectoryContents(path)
      
      if (result.success && result.data) {
        setFiles(result.data)
        setCurrentPath(path)
        
        // 只有在路径实际变化时才更新历史记录
        if (path !== pathHistory[historyIndex]) {
          setPathHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1)
            if (!newHistory.includes(path)) {
              newHistory.push(path)
            }
            return newHistory
          })
          setHistoryIndex(prev => {
            const newHistory = pathHistory.slice(0, prev + 1)
            if (!newHistory.includes(path)) {
              return prev + 1
            }
            return newHistory.findIndex(p => p === path)
          })
        }
      } else {
        setError(result.error || '加载目录失败')
        setFiles([])
      }
    } catch (error) {
      console.error('WebDAVFileBrowser: 加载目录异常:', error)
      setError(`加载目录异常: ${error instanceof Error ? error.message : '未知错误'}`)
      setFiles([])
    } finally {
      setIsLoading(false)
    }
  }

  // 处理目录点击
  const handleDirectoryClick = (directory: WebDAVFileInfo) => {
    if (directory.type === 'directory') {
      console.log('点击目录:', directory.filename)
      // 确保使用相对路径
      let newPath = directory.filename
      
      newPath = normalizeDavPath(newPath)

      if (!newPath.endsWith('/')) {
        newPath = newPath + '/'
      }

      
      console.log('设置新路径:', newPath)
      
      // 更新历史记录
      const newHistory = pathHistory.slice(0, historyIndex + 1)
      newHistory.push(newPath)
      setPathHistory(newHistory)
      setHistoryIndex(newHistory.length - 1)
      
      // 设置路径（useEffect会自动加载目录）
      setCurrentPath(newPath)
    }
  }

  // 处理文件点击
  const handleFileClick = (file: WebDAVFileInfo) => {
    if (file.type === 'file') {
      setSelectedFile(file)
    }
  }

  // 处理文件下载
  const handleDownloadFile = async () => {
    if (selectedFile && selectedFile.type === 'file') {
      setIsDownloading(true)
      try {
        // 下载文件内容，传递文件名以避免特殊字符问题
        const downloadResult = await webdavService.downloadFileAsFile(selectedFile.filename, selectedFile.basename)
        
        if (!downloadResult.success || !downloadResult.data) {
          console.error('下载文件失败:', downloadResult.error)
          setError(downloadResult.error || '下载文件失败')
          return
        }
        
        // 创建下载链接
        const url = URL.createObjectURL(downloadResult.data)
        const link = document.createElement('a')
        link.href = url
        link.download = selectedFile.basename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        
        console.log('文件下载成功:', selectedFile.basename)
      } catch (error) {
        console.error('文件下载失败:', error)
        setError('文件下载失败')
      } finally {
        setIsDownloading(false)
      }
    }
  }

  // 处理文件选择确认
  const handleFileSelect = async () => {
    if (selectedFile) {
      setIsDownloading(true)
      try {
        // 下载文件内容，传递文件名以避免特殊字符问题
        const downloadResult = await webdavService.downloadFileAsFile(selectedFile.filename, selectedFile.basename)
        
        if (!downloadResult.success || !downloadResult.data) {
          console.error('下载文件失败:', downloadResult.error)
          setError(downloadResult.error || '下载文件失败')
          return
        }
        
        // 传递下载的File对象给父组件
        onFileSelect(downloadResult.data)
        onClose()
      } catch (error) {
        console.error('文件选择失败:', error)
        setError('文件选择失败')
      } finally {
        setIsDownloading(false)
      }
    }
  }

  // 导航到上级目录
  const navigateUp = () => {
    console.log('当前路径:', currentPath)
    
    // 如果已经是根目录，不能向上导航
    if (currentPath === '/' || currentPath === '') {
      return
    }
    
    // 处理路径分割
    const pathParts = currentPath.split('/').filter(part => part !== '')
    console.log('路径分割:', pathParts)
    
    // 移除最后一部分（当前目录）
    pathParts.pop()
    
    // 构建上级目录路径
    let parentPath: string
    if (pathParts.length === 0) {
      parentPath = '/' // 回到根目录
    } else {
      parentPath = '/' + pathParts.join('/') + '/'
    }
    
    console.log('上级目录路径:', parentPath)
    
    // 更新历史记录
    const newHistory = pathHistory.slice(0, historyIndex + 1)
    newHistory.push(parentPath)
    setPathHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    
    // 设置路径（useEffect会自动加载目录）
    setCurrentPath(parentPath)
  }

  // 历史导航
  const navigateBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      // 设置路径（useEffect会自动加载目录）
      setCurrentPath(pathHistory[newIndex])
    }
  }

  const navigateForward = () => {
    if (historyIndex < pathHistory.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      // 设置路径（useEffect会自动加载目录）
      setCurrentPath(pathHistory[newIndex])
    }
  }

  // 刷新当前目录
  const refreshDirectory = () => {
    loadDirectory(currentPath)
  }

  // 排序文件
  const sortFiles = (filesToSort: WebDAVFileInfo[]) => {
    const sortedFiles = [...filesToSort]
    
    // 分离目录和文件
    const directories = sortedFiles.filter(file => file.type === 'directory')
    const files = sortedFiles.filter(file => file.type === 'file')
    
    // 排序函数
    const sortFunction = (a: WebDAVFileInfo, b: WebDAVFileInfo) => {
      if (sortBy === 'name') {
        return sortOrder === 'asc' 
          ? a.basename.localeCompare(b.basename)
          : b.basename.localeCompare(a.basename)
      } else if (sortBy === 'time') {
        const timeA = new Date(a.lastmod).getTime()
        const timeB = new Date(b.lastmod).getTime()
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA
      } else if (sortBy === 'random') {
        return Math.random() - 0.5
      }
      return 0
    }
    
    // 分别排序目录和文件
    directories.sort(sortFunction)
    files.sort(sortFunction)
    
    // 目录在前，文件在后
    return [...directories, ...files]
  }

  // 过滤文件
  const filteredFiles = files.filter(file => {
    // 搜索过滤
    if (searchQuery && !file.basename.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    
    // 文件类型过滤
    if (file.type === 'file' && allowedExtensions.length > 0) {
      const extension = '.' + file.basename.toLowerCase().split('.').pop()
      return allowedExtensions.includes(extension)
    }
    
    return true
  })

  // 应用排序
  const sortedFilteredFiles = sortFiles(filteredFiles)

  // 检查是否可以导航到上级目录
  const canNavigateUp = currentPath !== '/'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            WebDAV文件浏览器
          </DialogTitle>
          <DialogDescription>
            从WebDAV服务器选择要导入的文件
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 space-y-3 overflow-hidden">
          {/* 工具栏 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 导航按钮 */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={navigateBack}
                disabled={historyIndex <= 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={navigateForward}
                disabled={historyIndex >= pathHistory.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={navigateUp}
                disabled={!canNavigateUp}
              >
                <ChevronUp className="h-4 w-4" />
                上级
              </Button>
            </div>

            {/* 刷新按钮 */}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshDirectory}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>

            {/* 搜索框 */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索文件..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* 排序控件 */}
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={(value: 'name' | 'time' | 'random') => setSortBy(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">名称</SelectItem>
                  <SelectItem value="time">时间</SelectItem>
                  <SelectItem value="random">乱序</SelectItem>
                </SelectContent>
              </Select>
              
              {sortBy !== 'random' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="w-10 p-0"
                >
                  {sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                </Button>
              )}
              
              {sortBy === 'random' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFiles([...files])}
                  className="w-10 p-0"
                  title="重新打乱"
                >
                  <Shuffle className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* 当前路径 */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
            <FolderOpen className="h-4 w-4" />
            <span className="truncate" title={currentPath}>当前路径: {currentPath}</span>
          </div>

          {/* 错误提示 */}
          {error && (
            <Alert className="border-red-200 flex-shrink-0">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 文件列表 */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-full w-full" orientation="both">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="ml-2">{t('common.loading')}</span>
                    </div>
                  ) : sortedFilteredFiles.length === 0 ? (
                    <EmptyState
                      icon={searchQuery ? Search : FolderOpen}
                      title={searchQuery ? t('webdav.noSearchResults') : t('webdav.emptyDirectory')}
                      description={searchQuery ? t('webdav.tryDifferentSearch') : t('webdav.emptyDirectoryDesc')}
                    />
                  ) : (
                    <div className="min-w-[800px]">
                      {sortedFilteredFiles.map((file, index) => (
                        <div
                          key={index}
                          className={`flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer border-b border-gray-100 dark:border-gray-800 ${
                            selectedFile?.filename === file.filename ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                          onClick={() => file.type === 'directory' ? handleDirectoryClick(file) : handleFileClick(file)}
                        >
                          {getFileIcon(file)}
                          <div className="flex-1 min-w-0 flex-shrink-0">
                            <div className="font-medium text-sm truncate" title={file.basename}>
                              {file.basename}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {file.type === 'directory' ? '目录' : formatFileSize(file.size)}
                              {file.type === 'file' && ` • ${formatDate(file.lastmod)}`}
                            </div>
                          </div>
                          {file.type === 'file' && allowedExtensions.includes('.' + file.basename.toLowerCase().split('.').pop()) && (
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 ml-2" />
                          )}
                          {file.type === 'file' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-8 h-8 p-0 flex-shrink-0 ml-1"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                setSelectedFile(file)
                                handleDownloadFile()
                              }}
                              title="下载文件"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* 选中文件信息 */}
          {selectedFile && selectedFile.type === 'file' && (
            <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-md">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground" title={selectedFile.basename}>
                  {selectedFile.basename.length > 30 ? selectedFile.basename.substring(0, 30) + '...' : selectedFile.basename}
                </span>
                <span>大小: {formatFileSize(selectedFile.size)}</span>
                <span>修改: {formatDate(selectedFile.lastmod)}</span>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-between items-center flex-shrink-0">
            <div className="text-sm text-muted-foreground truncate">
              支持格式: {allowedExtensions.join(', ')}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button 
                onClick={handleFileSelect}
                disabled={!selectedFile || selectedFile.type === 'directory' || isDownloading}
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    下载中...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    选择文件
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
