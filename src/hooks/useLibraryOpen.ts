import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { webdavService } from '@/services/webdavService'
import { unreachableLabel } from '@/components/library/labels'
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
  const resolveEntry = useLibraryStore((s) => s.resolveEntry)
  const askRemove = useLibraryStore((s) => s.askRemove)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  /** ready：选文件流程（含云缓存检查）已全部结束；之前不能下结论，否则会把"检查尚未开始"误当成"没有缓存" */
  const [autoLoad, setAutoLoad] = useState<{ name: string; ready: boolean } | null>(null)

  const openBook = useCallback(
    async (shelfEntry: LibraryEntry) => {
      setOpeningPath(shelfEntry.path)
      try {
        // 书架上的虚拟条目只有云端资料：先去 WebDAV 找到真实文件（这是第一次真正用到 WebDAV）
        const resolved = await resolveEntry(shelfEntry)
        if (resolved.kind === 'unreachable') {
          toast.error(unreachableLabel(t, resolved.reason))
          return
        }
        if (resolved.kind === 'missing') {
          askRemove(shelfEntry)
          return
        }
        // 真实条目来自 WebDAV 索引，没有云端 id：沿用书架条目上叠加的 catalogId
        const entry: LibraryEntry = { ...resolved.entry, catalogId: shelfEntry.catalogId ?? resolved.entry.catalogId }
        const name = baseName(entry.path)
        const r = await webdavService.downloadFileAsFile(entry.path, name)
        if (!r.success || !r.data) {
          // 区分「文件确实没了」和「网络 / 权限问题」：只有前者才提示删除 metadata，后者绝不能动数据
          if ((await webdavService.existsStatus(entry.path).catch(() => 'unknown')) === 'missing') askRemove(entry)
          else toast.error(t('library.openFailed', { error: r.error ?? '' }))
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
    [handleWebDAVFileSelect, markOpened, contributeOpened, resolveEntry, askRemove, t]
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
