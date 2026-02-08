/**
 * WebDAV配置类型定义
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WebDAVConfig {
  enabled: boolean
  serverUrl: string
  username: string
  password: string
  appName: string
  autoSync: boolean
  syncPath: string
  browsePath: string
  lastSyncTime: string | null
  connectionStatus: ConnectionStatus
}

export interface WebDAVState {
  webdavConfig: WebDAVConfig

  // WebDAV配置设置方法
  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  setWebDAVPassword: (password: string) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void
  setWebDAVBrowsePath: (browsePath: string) => void
  setWebDAVConnectionStatus: (status: ConnectionStatus) => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void
}
