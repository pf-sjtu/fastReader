import { useWebDAVStore } from '../../stores/webdav'

/** 绑定所需的服务最小接口（避免与 WebDAVService 循环依赖） */
export interface DavBindable {
  disconnect(): void
  updateConfig(config: Partial<ReturnType<typeof useWebDAVStore.getState>['webdavConfig']>): void
}

/**
 * 让服务跟随 WebDAV 配置 store：
 * - serverUrl / username / password 变化 → disconnect，调用方见 isInitialized()=false 会用新配置重新 initialize
 * - 其余字段（syncPath、browsePath…）变化 → 直接合并进当前配置
 * @returns 取消订阅函数
 */
export function bindWebDAVServiceToStore(service: DavBindable): () => void {
  return useWebDAVStore.subscribe((next, prev) => {
    const a = next.webdavConfig
    const b = prev.webdavConfig
    if (a === b) return
    if (a.serverUrl !== b.serverUrl || a.username !== b.username || a.password !== b.password) {
      service.disconnect()
      return
    }
    service.updateConfig(a)
  })
}
