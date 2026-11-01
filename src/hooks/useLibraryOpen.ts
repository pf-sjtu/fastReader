import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { webdavService } from '@/services/webdavService'
import { baseName } from '@/services/library/libraryIndex'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'

interface Params {
  file: File | null
  cloudCacheContent: string | null | undefined
  isCheckingCloudCache: boolean
  handleWebDAVFileSelect: (file: File) => Promise<void>
  /** 加载云端缓存并进入阅读工作台 */
  handleLoadFromCloudCache: () => void
}

/**
 * 从书库打开一本书：下载 → 走与「选文件」相同的流程（云缓存检查 + 提取章节）。
 * 已精读的书不再让用户多点一次「使用云端缓存」：缓存检查完成后自动进入工作台。
 * 只对"这一次从书库打开的这个文件"生效（按文件名匹配），不会误伤之后手动选的文件。
 * autoOpening：已精读的书正在自动进入工作台（界面应显示骨架屏而不是「文件上传与配置」卡）。
 */
export function useLibraryOpen({
  file,
  cloudCacheContent,
  isCheckingCloudCache,
  handleWebDAVFileSelect,
  handleLoadFromCloudCache,
}: Params) {
  const { t } = useTranslation()
  const markOpened = useLibraryStore((s) => s.markOpened)
  const contributeOpened = useLibraryStore((s) => s.contributeOpened)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  /** ready：选文件流程（含云缓存检查）已全部结束；之前不能下结论，否则会把"检查尚未开始"误当成"没有缓存" */
  const [autoLoad, setAutoLoad] = useState<{ name: string; ready: boolean } | null>(null)

  const openBook = useCallback(
    async (entry: LibraryEntry) => {
      setOpeningPath(entry.path)
      try {
        const name = baseName(entry.path)
        const r = await webdavService.downloadFileAsFile(entry.path, name)
        if (!r.success || !r.data) {
          toast.error(t('library.openFailed', { error: r.error ?? '' }))
          return
        }
        const picked = r.data.name
        setAutoLoad(entry.status === 'done' ? { name: picked, ready: false } : null)
        try {
          await handleWebDAVFileSelect(r.data)
        } catch (e) {
          // 选文件流程抛错：不能让「正在打开」骨架屏一直挂着
          setAutoLoad((cur) => (cur?.name === picked ? null : cur))
          throw e
        }
        setAutoLoad((cur) => (cur?.name === picked ? { name: picked, ready: true } : cur))
        void markOpened(entry)
        // 云端还没有这本书的封面 / 元数据：趁文件已经下载，顺手解析并补传（只做一次，之后谁都能直接命中）
        void contributeOpened(entry, r.data)
      } finally {
        setOpeningPath(null)
      }
    },
    [handleWebDAVFileSelect, markOpened, contributeOpened, t]
  )

  useEffect(() => {
    if (!autoLoad?.ready) return
    // 文件被换掉：放弃自动进入
    if (!file || file.name !== autoLoad.name) {
      setAutoLoad(null)
      return
    }
    if (isCheckingCloudCache) return
    setAutoLoad(null)
    if (cloudCacheContent) handleLoadFromCloudCache()
  }, [autoLoad, file, cloudCacheContent, isCheckingCloudCache, handleLoadFromCloudCache])

  return { openBook, openingPath, autoOpening: autoLoad !== null }
}
