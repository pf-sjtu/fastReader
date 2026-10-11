// WebDAV 客户端就绪 + 统一错误文案：BatchProcessingDialog / WebDAVFileBrowser / WebDAVConfig 共用。
// webdavService 已通过 bindWebDAVServiceToStore 跟随 store：凭据变化会自动 disconnect，
// 这里只需「未初始化 → 用 store 最新配置 initialize」。
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore, useWebDAVConfig } from '../../../stores/configStore'
import { webdavService, type WebDAVFileInfo } from '../../../services/webdavService'

export type DirectoryResult = { ok: true; files: WebDAVFileInfo[] } | { ok: false; error: string }

type WebDAVConfigShape = ReturnType<typeof useConfigStore.getState>['webdavConfig']

export function isWebDAVConfigComplete(c: WebDAVConfigShape): boolean {
  return !!(c.serverUrl && c.username && c.password)
}

export function useWebDAVClient() {
  const { t } = useTranslation()
  const config = useWebDAVConfig()

  const errorText = useCallback(
    (err: unknown) => (err instanceof Error ? err.message : t('common.unknownError')),
    [t]
  )

  /**
   * 确保服务已初始化。force=true 时总是用最新配置重新 initialize（连接测试用）。
   * @returns null 表示就绪，否则为可展示的错误文案
   */
  const ensureReady = useCallback(
    async (force = false): Promise<string | null> => {
      if (!force && webdavService.isInitialized()) return null
      // 读 store 最新值：回调保持稳定，不随配置对象变化而重建（避免 effect 反复触发）
      const latest = useConfigStore.getState().webdavConfig
      if (!latest.enabled) return t('webdav.errors.disabled')
      if (!isWebDAVConfigComplete(latest)) return t('webdav.errors.incomplete')
      try {
        const r = await webdavService.initialize(latest)
        return r.success ? null : t('webdav.errors.initFailed', { error: r.error || t('common.unknownError') })
      } catch (err) {
        return t('webdav.errors.initException', { error: errorText(err) })
      }
    },
    [t, errorText]
  )

  /** 列目录（含按需初始化）；失败返回统一文案 */
  const listDirectory = useCallback(
    async (path: string): Promise<DirectoryResult> => {
      const initError = await ensureReady()
      if (initError) return { ok: false, error: initError }
      try {
        const r = await webdavService.getDirectoryContents(path)
        if (r.success && r.data) return { ok: true, files: r.data }
        return { ok: false, error: r.error || t('webdav.errors.loadFailed') }
      } catch (err) {
        return { ok: false, error: t('webdav.errors.loadException', { error: errorText(err) }) }
      }
    },
    [ensureReady, t, errorText]
  )

  return { config, isComplete: config.enabled && isWebDAVConfigComplete(config), ensureReady, listDirectory, errorText }
}
