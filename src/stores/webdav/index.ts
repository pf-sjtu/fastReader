// WebDAV 配置 Store
//
// 凭据（password）只存在于服务端：客户端状态里是 `{ hasSecret: true }`，
// 用户新输入的密码放到内存 pendingSecret，随下一次写回提交。
import { create } from 'zustand'
import type { WebDAVConfig } from '../types'
import type { SecretRef } from '../../types/ai'
import { markDirty, registerSection } from '../../services/shared/sharedState'

const SECTION = 'webdav' as const

export const defaultWebDAVConfig: WebDAVConfig = {
  enabled: false,
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  appName: 'fastReader_by_PF',
  autoSync: false,
  syncPath: '/fastReader',
  browsePath: '/',
  lastSyncTime: null,
  connectionStatus: 'disconnected',
}

/** 待提交的明文密码（null = 清除） */
let pendingPassword: string | null | undefined

export interface WebDAVState {
  webdavConfig: WebDAVConfig

  setWebDAVEnabled: (enabled: boolean) => void
  setWebDAVServerUrl: (serverUrl: string) => void
  setWebDAVUsername: (username: string) => void
  /** 传入新密码时只记录待提交值；传 null 表示清除 */
  setWebDAVPassword: (password: string | null) => void
  setWebDAVAppName: (appName: string) => void
  setWebDAVAutoSync: (autoSync: boolean) => void
  setWebDAVSyncPath: (syncPath: string) => void
  setWebDAVBrowsePath: (browsePath: string) => void
  setWebDAVConnectionStatus: (status: WebDAVConfig['connectionStatus']) => void
  updateWebDAVLastSyncTime: () => void
  resetWebDAVConfig: () => void

  updateWebDAVConfig: (config: Partial<WebDAVConfig>) => void
  replaceWebDAV: (config: WebDAVConfig) => void
}

export const useWebDAVStore = create<WebDAVState>()((set, get) => {
  const commit = (patch: Partial<WebDAVConfig>) => {
    set({ webdavConfig: { ...get().webdavConfig, ...patch } })
    markDirty(SECTION)
  }

  return {
    webdavConfig: defaultWebDAVConfig,

    setWebDAVEnabled: (enabled) => commit({ enabled }),
    setWebDAVServerUrl: (serverUrl) => commit({ serverUrl }),
    setWebDAVUsername: (username) => commit({ username }),

    setWebDAVPassword: (password) => {
      pendingPassword = password === null ? null : password
      commit({
        password: password === null ? undefined : ({ hasSecret: true } satisfies SecretRef),
      })
    },

    setWebDAVAppName: (appName) => commit({ appName }),
    setWebDAVAutoSync: (autoSync) => commit({ autoSync }),
    setWebDAVSyncPath: (syncPath) => commit({ syncPath }),
    setWebDAVBrowsePath: (browsePath) => commit({ browsePath }),
    // 连接状态是运行时状态：只改内存，不必写服务端
    setWebDAVConnectionStatus: (connectionStatus) =>
      set({ webdavConfig: { ...get().webdavConfig, connectionStatus } }),

    updateWebDAVLastSyncTime: () =>
      set({ webdavConfig: { ...get().webdavConfig, lastSyncTime: new Date().toISOString() } }),

    resetWebDAVConfig: () => {
      pendingPassword = null
      set({ webdavConfig: defaultWebDAVConfig })
      markDirty(SECTION)
    },

    updateWebDAVConfig: (config) => commit(config),

    replaceWebDAV: (config) => {
      pendingPassword = undefined
      set({ webdavConfig: { ...defaultWebDAVConfig, ...config } })
      markDirty(SECTION)
    },
  }
})

/** 写回服务端时叠加待提交的明文密码 */
export function serializeWebDAV(config: WebDAVConfig): Record<string, unknown> {
  if (pendingPassword === undefined) return { ...config }
  if (pendingPassword === null) {
    // 服务端把「字段缺席」当成「保留原值」，清空必须显式发 null
    return { ...config, password: null }
  }
  return { ...config, password: pendingPassword }
}

registerSection<WebDAVConfig>(
  SECTION,
  {
    getData: () => serializeWebDAV(useWebDAVStore.getState().webdavConfig) as unknown as WebDAVConfig,
    setData: (data) => {
      const config: WebDAVConfig = {
        ...defaultWebDAVConfig,
        ...(data ?? {}),
        connectionStatus: 'disconnected',
      }
      useWebDAVStore.setState({ webdavConfig: config })
    },
    debounceMs: 800,
    afterFlush: () => {
      pendingPassword = undefined
    },
  },
  { autoWrite: false }
)

/** 内存里待提交的明文密码（导出「包含密钥」时使用） */
export function getPendingWebDAVPassword(): string | undefined {
  return typeof pendingPassword === 'string' ? pendingPassword : undefined
}

/** 是否已配置 WebDAV 凭据（客户端可见） */
export function hasWebDAVCredentials(config: WebDAVConfig | undefined): boolean {
  return Boolean(config?.serverUrl && config?.username && config?.password?.hasSecret)
}

// 便捷选择器
export const useWebDAVConfig = () => useWebDAVStore((state) => state.webdavConfig)
