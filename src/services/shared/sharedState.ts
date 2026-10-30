/**
 * 共享状态层：拉全量 → 写入各 store → 订阅变更并按节防抖写回。
 *
 * 冲突处理采用三方合并：base = 上次成功同步的远端值，local = 当前，remote = 409 返回的最新值。
 * - 只有本地改过 → 用本地
 * - 只有远端改过 → 用远端
 * - 双方都改且不同：对象继续向下合并；标量/数组由远端胜出并记一条冲突提示
 */
import { create } from 'zustand'
import {
  ConflictError,
  SharedApiError,
  UnauthorizedError,
  sharedApi,
  type SectionSnapshot,
} from './api'
import { logger } from '../../lib/logger'

export type SyncStatus = 'idle' | 'loading' | 'syncing' | 'conflict' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  initialized: boolean
  lastSyncedAt: string | null
  /** 最近一次冲突涉及的字段路径（用于 UI 提示） */
  conflicts: string[]
  error: string | null
  setStatus: (status: SyncStatus, patch?: Partial<Omit<SyncState, 'setStatus'>>) => void
}

export const useSyncStatusStore = create<SyncState>()((set) => ({
  status: 'idle',
  initialized: true,
  lastSyncedAt: null,
  conflicts: [],
  error: null,
  setStatus: (status, patch) => set({ status, ...(patch ?? {}) }),
}))

export type SectionName = 'ai' | 'processing' | 'webdav' | 'prompts' | 'history' | 'batch' | 'usage' | 'modelQuirks'

interface SectionBinding<T = unknown> {
  /** 从 store 读当前可写数据 */
  getData: () => T
  /** 把服务端数据写进 store（hydrate / 冲突合并后用） */
  setData: (data: T) => void
  /** 防抖毫秒；0 表示只允许显式 flush（如批量队列） */
  debounceMs: number
  /** 写入成功后回调（如清掉内存里的待提交明文密钥） */
  afterFlush?: () => void
}

const SECTIONS: SectionName[] = ['ai', 'processing', 'webdav', 'prompts', 'history', 'batch', 'usage', 'modelQuirks']

const bindings = new Map<SectionName, SectionBinding>()
/** 上次成功同步（或 hydrate）的远端值，作为三方合并的 base */
const remoteBase = new Map<SectionName, unknown>()
const revs = new Map<SectionName, number>()
const timers = new Map<SectionName, ReturnType<typeof setTimeout>>()
const inFlight = new Set<SectionName>()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => deepEqual(a[key], b[key]))
  }
  return false
}

export interface MergeResult<T> {
  value: T
  conflicts: string[]
}

/**
 * 三方合并。数组与标量视为原子值（冲突时远端胜出）——数组内部合并容易把模型列表改乱。
 */
export function mergeThreeWay<T>(base: unknown, local: unknown, remote: unknown, path = ''): MergeResult<T> {
  const localChanged = !deepEqual(local, base)
  const remoteChanged = !deepEqual(remote, base)

  if (!localChanged) return { value: remote as T, conflicts: [] }
  if (!remoteChanged) return { value: local as T, conflicts: [] }
  if (deepEqual(local, remote)) return { value: local as T, conflicts: [] }

  if (isPlainObject(local) && isPlainObject(remote)) {
    const baseObj = isPlainObject(base) ? base : {}
    const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(baseObj)])
    const out: Record<string, unknown> = {}
    const conflicts: string[] = []

    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key
      const result = mergeThreeWay(baseObj[key], local[key], remote[key], childPath)
      if (result.value !== undefined) out[key] = result.value
      conflicts.push(...result.conflicts)
    }
    return { value: out as T, conflicts }
  }

  // 标量或数组双改：远端胜出
  return { value: remote as T, conflicts: [path || '(root)'] }
}

/**
 * 注册一个分区与某个 store 的绑定。
 *
 * @param trigger 订阅函数（通常传 zustand 的 `subscribeWithSelector` 版本或手动比较）
 */
export function registerSection<T>(
  section: SectionName,
  binding: SectionBinding<T>,
  options: { autoWrite?: boolean } = {}
): () => void {
  bindings.set(section, binding as SectionBinding)

  if (options.autoWrite === false) return () => bindings.delete(section)

  // 无法通用地拿到 store 的 subscribe：调用方在 store 内部用 subscribe 触发下面导出的 markDirty
  return () => bindings.delete(section)
}

/** store 变更后调用：按防抖把该节写回服务端 */
export function markDirty(section: SectionName, debounceMs?: number): void {
  const binding = bindings.get(section)
  if (!binding) return
  if (inFlight.has(section)) {
    // 写入进行中：稍后重试，保证最后一次改动不丢
    scheduleFlush(section, binding, Math.max(debounceMs ?? binding.debounceMs, 300))
    return
  }
  scheduleFlush(section, binding, debounceMs ?? binding.debounceMs)
}

/** 每个分区「第一次变脏」的时间戳，用于 maxWait 兜底 */
const firstDirtyAt = new Map<SectionName, number>()
const MAX_WAIT_MS = 10_000

function scheduleFlush(section: SectionName, binding: SectionBinding, delay: number): void {
  const now = Date.now()
  if (!firstDirtyAt.has(section)) firstDirtyAt.set(section, now)

  const existing = timers.get(section)
  if (existing) clearTimeout(existing)

  // 纯防抖在「进度条每 2s 更新一次」这类场景下永远不触发；超过 MAX_WAIT 就立即写
  const waited = now - (firstDirtyAt.get(section) ?? now)
  const effective = Math.max(0, Math.min(delay, MAX_WAIT_MS - waited))

  const timer = setTimeout(() => {
    timers.delete(section)
    firstDirtyAt.delete(section)
    void flushSection(section, binding)
  }, effective)
  timers.set(section, timer)
}

/**
 * 立即写入（页面隐藏 / 完成后 / 初始化向导调用）。
 *
 * @param force 跳过「与上次同步值相同就不写」的短路——首次初始化服务端时本地值恰好等于
 *              默认值（base），不 force 就一个字节都不会写，服务端永远停留在「未初始化」。
 */
export async function flushSection(
  section: SectionName,
  bindingOverride?: SectionBinding,
  options: { force?: boolean; keepalive?: boolean } = {}
): Promise<void> {
  const binding = bindingOverride ?? bindings.get(section)
  if (!binding) return
  const existing = timers.get(section)
  if (existing) {
    clearTimeout(existing)
    timers.delete(section)
  }

  const local = binding.getData()
  const base = remoteBase.get(section)
  if (!options.force && base !== undefined && deepEqual(local, base)) {
    return // 没有实际变化，不浪费 KV 写额度
  }

  inFlight.add(section)
  useSyncStatusStore.getState().setStatus('syncing')
  try {
    const rev = revs.get(section) ?? 0
    const result = await sharedApi.putSection(section, local, rev, { keepalive: options.keepalive })
    revs.set(section, result.rev)
    binding.afterFlush?.()

    // 关键：base 必须是「本次真正发出去的值」，不能回读当前 store。
    // await 期间用户可能又改了；回读会把未发送的新值当成已同步，接下来那次 flush 会被
    // deepEqual 短路，那部分改动就永久丢了（要等用户再改一次才可能写上去）。
    const current = binding.getData()
    remoteBase.set(section, deepEqual(current, local) ? current : local)
    useSyncStatusStore.getState().setStatus('idle', {
      lastSyncedAt: result.updatedAt,
      conflicts: [],
      error: null,
    })
  } catch (error) {
    if (error instanceof ConflictError) {
      await resolveConflict(section, binding, local, error)
    } else if (error instanceof UnauthorizedError) {
      useSyncStatusStore.getState().setStatus('error', { error: 'unauthorized' })
      throw error
    } else if (error instanceof SharedApiError && (error.status === 0 || error.status >= 500)) {
      // 网络/服务端故障：保留本地改动，稍后重试
      useSyncStatusStore.getState().setStatus('offline', { error: error.message })
      scheduleFlush(section, binding, 5000)
    } else {
      logger.error(`[shared-state] 写入 ${section} 失败:`, error)
      useSyncStatusStore.getState().setStatus('error', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    inFlight.delete(section)
  }
}

async function resolveConflict(
  section: SectionName,
  binding: SectionBinding,
  local: unknown,
  conflict: ConflictError
): Promise<void> {
  const base = remoteBase.get(section)
  const merged = mergeThreeWay(base, local, conflict.data)

  revs.set(section, conflict.rev)
  binding.setData(merged.value)
  // setData 会触发 store 变更（进而 markDirty），这里直接把合并结果作为 base 并续写
  remoteBase.set(section, merged.value)

  useSyncStatusStore.getState().setStatus(merged.conflicts.length > 0 ? 'conflict' : 'syncing', {
    conflicts: merged.conflicts,
  })

  try {
    const result = await sharedApi.putSection(section, merged.value, conflict.rev)
    revs.set(section, result.rev)
    binding.afterFlush?.()
    remoteBase.set(section, binding.getData())
    useSyncStatusStore.getState().setStatus('idle', { lastSyncedAt: result.updatedAt, error: null })
  } catch (error) {
    logger.error(`[shared-state] 冲突合并后写回 ${section} 失败:`, error)
    useSyncStatusStore.getState().setStatus('error', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface LoadResult {
  initialized: boolean
}

/** 拉全量并写入所有已绑定的 store */
export async function loadAll(): Promise<LoadResult> {
  useSyncStatusStore.getState().setStatus('loading')
  const state = await sharedApi.getState()

  for (const section of SECTIONS) {
    const binding = bindings.get(section)
    const snapshot = state.sections[section] as SectionSnapshot | undefined

    if (snapshot) {
      revs.set(section, snapshot.rev)
      remoteBase.set(section, snapshot.data)
      binding?.setData(snapshot.data)
    } else {
      revs.set(section, 0)
      remoteBase.set(section, binding?.getData() ?? {})
    }
  }

  useSyncStatusStore.getState().setStatus('idle', {
    initialized: state.initialized,
    lastSyncedAt: new Date().toISOString(),
    conflicts: [],
    error: null,
  })

  return { initialized: state.initialized }
}

/** 只刷新远端数据（轮询/聚焦），不覆盖本地未同步的改动 */
export async function resync(): Promise<void> {
  const state = useSyncStatusStore.getState()
  if (state.status === 'loading' || inFlight.size > 0) return

  let remote
  try {
    remote = await sharedApi.getState()
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error
    useSyncStatusStore.getState().setStatus('offline', {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const hadConflicts: string[] = []

  for (const section of SECTIONS) {
    const binding = bindings.get(section)
    const snapshot = remote.sections[section] as SectionSnapshot | undefined
    if (!snapshot || !binding) continue
    if ((revs.get(section) ?? 0) >= snapshot.rev) continue
    if (inFlight.has(section)) continue

    const local = binding.getData()
    const base = remoteBase.get(section)
    if (base !== undefined && !deepEqual(local, base)) {
      // 本地有未同步改动：走三方合并，避免静默覆盖
      const merged = mergeThreeWay(base, local, snapshot.data)
      binding.setData(merged.value)
      remoteBase.set(section, merged.value)
      revs.set(section, snapshot.rev)
      if (merged.conflicts.length > 0) {
        hadConflicts.push(...merged.conflicts)
        useSyncStatusStore.getState().setStatus('conflict', { conflicts: merged.conflicts })
      }
      // 合并结果必须写回，否则本地那部分改动会在下次 resync 被远端值覆盖
      await flushSection(section, binding, { force: true })
      continue
    }

    binding.setData(snapshot.data)
    remoteBase.set(section, snapshot.data)
    revs.set(section, snapshot.rev)
  }

  useSyncStatusStore.getState().setStatus(hadConflicts.length > 0 ? 'conflict' : 'idle', {
    lastSyncedAt: new Date().toISOString(),
    ...(hadConflicts.length > 0 ? { conflicts: hadConflicts } : {}),
  })
}

/** 把当前各分区强制写入服务端（初始化向导用：给服务端一个「已初始化」的基线） */
export async function flushAllSections(options: { force?: boolean } = {}): Promise<void> {
  await Promise.all(
    [...bindings.entries()].map(([section, binding]) =>
      flushSection(section, binding, options).catch((error) => {
        logger.error(`[shared-state] 写入 ${section} 失败:`, error)
      })
    )
  )
}

/** 追加型数据（历史 / 用量）直接走 append 接口 */
export async function appendToSection<T>(section: 'history' | 'usage' | 'modelQuirks', patch: unknown): Promise<T | null> {
  try {
    const snapshot = await sharedApi.appendSection<T>(section, patch)
    revs.set(section, snapshot.rev)
    remoteBase.set(section, snapshot.data)
    bindings.get(section)?.setData(snapshot.data)
    return snapshot.data
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error
    logger.error(`[shared-state] 追加 ${section} 失败:`, error)
    return null
  }
}

/** 测试用：清空模块内状态 */
export function __resetSharedState(): void {
  bindings.clear()
  remoteBase.clear()
  revs.clear()
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  inFlight.clear()
}

/** 测试用：读取内部版本表 */
export function __getRevs(): Map<SectionName, number> {
  return revs
}

/** 页面卸载/隐藏时尽力把待写数据落盘 */
export function installAutoFlush(): () => void {
  if (typeof window === 'undefined') return () => undefined

  const flushAll = () => {
    for (const [section, binding] of bindings.entries()) {
      // 有挂起的防抖才需要立即写；keepalive 让请求在页面卸载后仍能发出
      if (!timers.has(section)) continue
      void flushSection(section, binding, { keepalive: true })
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushAll()
  }

  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', onVisibility)

  const interval = window.setInterval(() => {
    void resync().catch((error) => {
      if (error instanceof UnauthorizedError) logger.warn('[shared-state] 会话已失效')
    })
  }, 60_000)
  const onFocus = () => {
    void resync().catch(() => undefined)
  }
  window.addEventListener('focus', onFocus)

  return () => {
    window.removeEventListener('pagehide', flushAll)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.clearInterval(interval)
  }
}
