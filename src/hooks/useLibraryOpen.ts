import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { webdavService } from '@/services/webdavService'
import { unreachableLabel } from '@/components/library/labels'
import { baseName } from '@/services/library/libraryIndex'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'
import { useOpenProgress } from '@/stores/openProgress'
import { openStatusText } from '@/components/library/openProgressLabels'

/** 下载中超过这么久没有新数据，就提示「连接较慢」 */
const STALL_MS = 8000

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
      const progress = useOpenProgress.getState()
      progress.start(shelfEntry.path, shelfEntry.title)
      // 全局 toast：不管书架还在不在屏幕上，用户都看得到进度；同一个 id 反复更新
      const toastId = `open:${shelfEntry.path}`
      const showToast = () => {
        const cur = useOpenProgress.getState()
        if (!cur.current) return
        toast.loading(t('library.download.toastTitle', { title: cur.current.title }), {
          id: toastId,
          description: openStatusText(t, cur.current),
          duration: Infinity,
          action: cur.cancel ? { label: t('library.download.cancel'), onClick: () => cur.cancel?.() } : undefined,
        })
      }
      showToast()
      let stallTimer: ReturnType<typeof setInterval> | null = null
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
        // 下载：可取消；久无数据提示「连接较慢」；总量优先用服务器的 Content-Length，没有就用书库索引里记的大小
        const ac = new AbortController()
        let lastDataAt = Date.now()
        progress.update({ phase: 'downloading', progress: null, stalled: false })
        progress.setCancel(() => ac.abort())
        showToast()
        stallTimer = setInterval(() => {
          const stalled = Date.now() - lastDataAt > STALL_MS
          if (stalled !== useOpenProgress.getState().current?.stalled) {
            progress.update({ stalled })
            showToast()
          }
        }, 1000)
        const r = await webdavService.downloadFileAsFile(entry.path, name, {
          signal: ac.signal,
          expectedSize: entry.size > 0 ? entry.size : undefined,
          onProgress: (p) => {
            lastDataAt = Date.now()
            progress.update({ progress: p, stalled: false })
            showToast()
          },
        })
        if (stallTimer) clearInterval(stallTimer)
        stallTimer = null
        progress.setCancel(null)
        // 用户取消：不是失败，更不能去怀疑「文件是不是没了」（那会弹出删除云端资料的确认）
        if (ac.signal.aborted) {
          toast.message(t('library.download.cancelled'))
          return
        }
        if (!r.success || !r.data) {
          // 区分「文件确实没了」和「网络 / 权限问题」：只有前者才提示删除 metadata，后者绝不能动数据
          if ((await webdavService.existsStatus(entry.path).catch(() => 'unknown')) === 'missing') askRemove(entry)
          else toast.error(t('library.openFailed', { error: r.error ?? '' }))
          return
        }
        progress.update({ phase: 'parsing', progress: null })
        showToast()
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
        if (stallTimer) clearInterval(stallTimer)
        toast.dismiss(toastId)
        progress.clear()
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
