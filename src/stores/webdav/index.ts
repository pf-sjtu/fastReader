// WebDAV配置Store
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WebDAVConfig } from '../types'

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

export interface WebDAVState {
  webdavConfig: WebDAVConfig

  // Actions
  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  setWebDAVPassword: (password: string) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void
  setWebDAVBrowsePath: (browsePath: string) => void
  setWebDAVConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void

  // 批量更新
  updateWebDAVConfig: (config: Partial<WebDAVConfig>) => void
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

      setWebDAVConnectionStatus: (connectionStatus) =>
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
        set({ webdavConfig: defaultWebDAVConfig }),

      updateWebDAVConfig: (config) =>
        set((state) => ({
          webdavConfig: { ...state.webdavConfig, ...config }
        }))
    }),
    {
      name: 'ebook-webdav-config',
      partialize: (state) => ({
        webdavConfig: state.webdavConfig
      })
    }
  )
)

// 便捷选择器
export const useWebDAVConfig = () => useWebDAVStore((state) => state.webdavConfig)
