import { useCallback, useEffect, useRef, useState } from 'react'
import { createLibraryIO } from '@/services/library/libraryIO'
import { createCoverLoader } from '@/services/library/coverLoader'

/** 全局单例：队列并发限制要跨所有书卡生效 */
export const coverLoader = createCoverLoader({ getIO: createLibraryIO })

/**
 * 书卡的真实封面：元素进入视口（含 200px 预取边距）才开始加载，离开后不取消已发出的请求
 * （结果仍会缓存到本地）。没有封面键或加载失败时返回 null，调用方显示生成式封面。
 */
export function useCoverUrl(coverKey: string | undefined): { ref: (el: Element | null) => void; url: string | null } {
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)

  const ref = useCallback((el: Element | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.current?.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.current.observe(el)
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  useEffect(() => {
    if (!visible || !coverKey) return
    let cancelled = false
    let objectUrl: string | null = null
    void coverLoader.load(coverKey).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [visible, coverKey])

  return { ref, url }
}
