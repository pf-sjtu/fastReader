import { useEffect, useState } from 'react'
import { webdavService } from '@/services/webdavService'
import type { WebDAVConfig } from '@/stores/configStore'
import { useReadingFocusStore } from '@/stores/readingFocus'

/** 滚动容器滚过 300px 后显示「回到顶部」 */
export function useBackToTop() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const scrollContainer = document.querySelector('.scroll-container')
    if (!scrollContainer) return
    const handleScroll = () => setShow(scrollContainer.scrollTop > 300)
    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [])
  return show
}

/** 正文阅读字体偏好 → <html data-reading-font>，由 index.css 选择字体栈 */
export function useReadingFontAttr() {
  const readingFont = useReadingFocusStore((s) => s.readingFont)
  useEffect(() => {
    document.documentElement.dataset.readingFont = readingFont
  }, [readingFont])
}

/**
 * WebDAV 自动连接：配置一变就（重新）连接，而不是只在挂载后 3 秒试一次。
 * 连上是预期状态，不弹提示（每次进站都弹还会压住书架）；失败由同步状态指示器体现。
 */
export function useWebDAVAutoConnect(webdavConfig: WebDAVConfig) {
  useEffect(() => {
    if (
      !webdavConfig.enabled ||
      !webdavConfig.serverUrl ||
      !webdavConfig.username ||
      !webdavConfig.password?.hasSecret ||
      webdavService.isInitialized()
    ) {
      return
    }
    webdavService.initialize(webdavConfig).catch((error) => console.error('App: WebDAV 自动连接异常:', error))
  }, [webdavConfig])
}
