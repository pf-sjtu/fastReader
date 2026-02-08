import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WebDAVConfig, WebDAVState, ConnectionStatus } from './types'

const defaultWebDAVConfig: WebDAVConfig = {
  enabled: false,
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  appName: 'fastReader_by_PF',
  autoSync: false,
  syncPath: '/fastReader',
  browsePath: '/',
  lastSyncTime: null,
  connectionStatus: 'disconnected'
}

export const useWebDAVStore = create<WebDAVState>()(
  persist(
    (set) => ({
      webdavConfig: defaultWebDAVConfig,

      setWebDAVEnabled: (enabled) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, enabled }
        })),

      setWebDAVServerUrl: (serverUrl) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, serverUrl }
        })),

      setWebDAVUsername: (username) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, username }
        })),

      setWebDAVPassword: (password) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, password }
        })),

      setWebDAVAppName: (appName) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, appName }
        })),

      setWebDAVAutoSync: (autoSync) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, autoSync }
        })),

      setWebDAVSyncPath: (syncPath) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, syncPath }
        })),

      setWebDAVBrowsePath: (browsePath) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, browsePath }
        })),

      setWebDAVConnectionStatus: (connectionStatus: ConnectionStatus) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, connectionStatus }
        })),

      updateWebDAVLastSyncTime: () =>
        set((state) => ({
          webdavConfig: {
            ...state.webdavConfig,
            lastSyncTime: new Date().toISOString()
          }
        })),

      resetWebDAVConfig: () =>
        set(() => ({
          webdavConfig: defaultWebDAVConfig
        }))
    }),
    {
      name: 'webdav-config-store',
      partialize: (state) => ({
        webdavConfig: state.webdavConfig
      })
    }
  )
)

// 导出便捷选择器
export const useWebDAVConfig = () =>
  useWebDAVStore((state) => state.webdavConfig)
