// 批量处理对话框的「选文件」状态：目录浏览、云端缓存标记、多选
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { WebDAVFileInfo } from '../../../services/webdavService'
import { cloudCacheService } from '../../../services/cloudCacheService'
import { useWebDAVClient } from '../webdav/useWebDAVClient'
import { directoryPath, extOf, parentPath } from '../webdav/fileListUtils'

export const BATCH_EXTENSIONS = ['.epub', '.pdf']

export const isBatchBook = (f: WebDAVFileInfo) => f.type === 'file' && BATCH_EXTENSIONS.includes(extOf(f.basename))

export function useBatchFileSelection(isOpen: boolean) {
  const { t } = useTranslation()
  const { config, listDirectory } = useWebDAVClient()
  // 从配置的浏览路径开始（browsePath 为 serverUrl 下的绝对路径）
  const [currentPath, setCurrentPath] = useState(() => config.browsePath || '/')
  const [files, setFiles] = useState<WebDAVFileInfo[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<WebDAVFileInfo[]>([])
  const [isCheckingCache, setIsCheckingCache] = useState(false)
  // 云端已有缓存的文件名；null 表示尚未确认
  const [cachedNames, setCachedNames] = useState<Set<string> | null>(null)
  const loadSeqRef = useRef(0)

  const loadDirectory = useCallback(
    async (path: string) => {
      const seq = ++loadSeqRef.current
      setIsLoadingFiles(true)
      setError(null)
      const r = await listDirectory(path)
      if (seq !== loadSeqRef.current) return
      setFiles(r.ok ? r.files : [])
      if (!r.ok) setError(r.error)
      setIsLoadingFiles(false)
    },
    [listDirectory]
  )

  // 打开或路径变化时加载目录（listDirectory 内部按需初始化 WebDAV）
  useEffect(() => {
    if (isOpen) void loadDirectory(currentPath)
  }, [isOpen, currentPath, loadDirectory])

  // 每次目录内容变化都重新确认云端缓存（旧实现只看文件数，切到同样数量的目录时不会刷新）
  useEffect(() => {
    if (!isOpen || !files.some((f) => f.type === 'file')) {
      setCachedNames(null)
      return
    }
    let cancelled = false
    setIsCheckingCache(true)
    void cloudCacheService
      .fetchCacheFileNamesStatus()
      .catch((err: unknown) => ({ status: 'unknown' as const, error: err instanceof Error ? err.message : String(err) }))
      .then((status) => {
        if (cancelled) return
        if (status.status === 'unknown') {
          // 无法确认 ≠ 没有缓存：提示用户，真正开始处理时队列会再次确认并在失败时中止
          toast.warning(t('batch.cacheUnknown'), { description: status.error })
        }
        setCachedNames(status.status === 'ok' ? status.names : new Set())
        setIsCheckingCache(false)
      })
    return () => {
      cancelled = true
    }
  }, [files, isOpen, t])

  const hasCache = (f: WebDAVFileInfo): boolean | undefined =>
    cachedNames ? cloudCacheService.isCachedByFileName(f.basename, cachedNames) : undefined

  const navigateUp = () => {
    const parent = parentPath(currentPath)
    if (parent !== null) setCurrentPath(parent)
  }

  /** 目录：进入；书籍文件：切换选中 */
  const toggleEntry = (file: WebDAVFileInfo) => {
    if (file.type === 'directory') {
      setCurrentPath(directoryPath(file))
      return
    }
    if (!isBatchBook(file)) return
    setSelectedFiles((prev) =>
      prev.some((f) => f.basename === file.basename) ? prev.filter((f) => f.basename !== file.basename) : [...prev, file]
    )
  }

  /** 全选当前目录书籍；skipProcessed 时排除已有缓存的 */
  const selectAll = (skipProcessed: boolean) => {
    const books = files.filter(isBatchBook)
    setSelectedFiles(skipProcessed ? books.filter((f) => !hasCache(f)) : books)
  }

  return {
    currentPath,
    files,
    isLoadingFiles,
    error,
    selectedFiles,
    isCheckingCache,
    hasCache,
    loadDirectory,
    navigateUp,
    toggleEntry,
    selectAll,
    clearSelection: () => setSelectedFiles([]),
  }
}
