import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WebDAVConfig } from '../services/webdavService'

// WebDAV配置状态接口
interface WebDAVState {
  // WebDAV配置
  webdavConfig: WebDAVConfig
  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  setWebDAVPassword: (password: string) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void

  setWebDAVConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void
}

// 默认WebDAV配置
const defaultWebDAVConfig: WebDAVConfig = {
  enabled: false,
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  appName: 'md_reader_by_PF',
  autoSync: false,
  syncPath: '/mdReader',
  lastSyncTime: null,
  connectionStatus: 'disconnected',

}

export const useWebDAVStore = create<WebDAVState>()(
  persist(
    (set) => ({
      // WebDAV配置
      webdavConfig: defaultWebDAVConfig,
      setWebDAVEnabled: (enabled) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, enabled }
      })),
      setWebDAVServerUrl: (serverUrl) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, serverUrl }
      })),
      setWebDAVUsername: (username) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, username }
      })),
      setWebDAVPassword: (password) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, password }
      })),
      setWebDAVAppName: (appName) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, appName }
      })),
      setWebDAVAutoSync: (autoSync) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, autoSync }
      })),
      setWebDAVSyncPath: (syncPath) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, syncPath }
      })),
      setWebDAVConnectionStatus: (connectionStatus) => set((state) => ({
        webdavConfig: { ...state.webdavConfig, connectionStatus }
      })),

      updateWebDAVLastSyncTime: () => set((state) => ({
        webdavConfig: { 
          ...state.webdavConfig, 
          lastSyncTime: new Date().toISOString()
        }
      })),
      resetWebDAVConfig: () => set(() => ({
        webdavConfig: defaultWebDAVConfig
      }))
    }),
    {
      name: 'md-reader-webdav-storage',
      partialize: (state) => ({ webdavConfig: state.webdavConfig })
    }
  )
)

// 便捷的hook，用于获取WebDAV配置
export const useWebDAVConfig = () => {
  return useWebDAVStore((state) => state.webdavConfig)
}
