import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { webdavService } from '@/services/webdavService'
import type { WebDAVConfig } from '@/stores/configStore'

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

/** WebDAV 自动连接：配置一变就（重新）连接，而不是只在挂载后 3 秒试一次 */
export function useWebDAVAutoConnect(webdavConfig: WebDAVConfig) {
  const { t } = useTranslation()
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

    let cancelled = false
    void (async () => {
      try {
        const initResult = await webdavService.initialize(webdavConfig)
        if (!cancelled && initResult.success) toast.success(t('webdav.autoConnected'))
      } catch (error) {
        console.error('App: WebDAV 自动连接异常:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [webdavConfig, t])
}
