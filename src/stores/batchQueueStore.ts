import { create } from 'zustand'
import { markDirty, registerSection } from '../services/shared/sharedState'

/**
 * 队列项状态
 */
export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

/**
 * 批量队列项
 */
export interface BatchQueueItem {
  id: string
  fileName: string
  filePath: string
  status: QueueItemStatus
  progress: number // 0-100
  error?: string
  metadata?: {
    chapterCount?: number
    processedChapters?: number
    skippedChapters?: number
    isPartial?: boolean
    startTime?: string
    endTime?: string
    costUSD?: number
    costRMB?: number
  }

  selectedChapters?: number[]
}

/**
 * 批量处理配置
 */
export interface BatchProcessingConfig {
  sourcePath: string
  maxFiles: number // 0 表示全部
  skipProcessed: boolean
  order: 'sequential' | 'random'
  bookType: 'fiction' | 'non-fiction'
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  chapterDetectionMode: 'normal' | 'smart' | 'epub-toc'
  outputLanguage: string
  requestThrottleMs?: number
  /** 文件级并行上限，默认 3 */
  fileConcurrency?: number
  /** 单文件内章节 AI 并行上限，默认跟随 processingOptions.chapterConcurrency */
  chapterConcurrency?: number
}

/**
 * 批量处理状态
 */
export interface BatchProcessingState {
  // 队列
  queue: BatchQueueItem[]

  // 配置
  config: BatchProcessingConfig | null

  // 全局状态
  isProcessing: boolean
  isPaused: boolean
  currentItemIndex: number

  // 统计
  stats: {
    total: number
    completed: number
    failed: number
    skipped: number
    totalCostUSD: number
    totalCostRMB: number
  }

  // Actions
  setConfig: (config: BatchProcessingConfig) => void
  addToQueue: (items: Omit<BatchQueueItem, 'id' | 'status' | 'progress'>[]) => void
  removeFromQueue: (id: string) => void
  clearQueue: () => void
  startProcessing: () => void
  pauseProcessing: () => void
  resumeProcessing: () => void
  stopProcessing: () => void
  updateItem: (id: string, updates: Partial<BatchQueueItem>) => void
  markItemCompleted: (id: string, metadata?: BatchQueueItem['metadata']) => void
  markItemFailed: (id: string, error: string) => void
  markItemSkipped: (id: string) => void
  nextItem: () => void
  getNextPendingItem: () => BatchQueueItem | null
  getCurrentItem: () => BatchQueueItem | null
  resetStats: () => void

  // 执行租约：共享队列同一时刻只允许一个浏览器执行
  runner: BatchRunnerLease | null
  /** 本客户端的标识（每次加载页面生成一次） */
  clientId: string
  acquireRunner: () => boolean
  /** 执行期间每 30s 续租（单本书常常超过 RUNNER_TIMEOUT_MS，只在每本书开始时续是不够的） */
  startHeartbeat: () => void
  stopHeartbeat: () => void
  heartbeatRunner: () => void
  releaseRunner: () => void
  isRunnerStale: () => boolean
}

/** 批量队列的执行租约 */
export interface BatchRunnerLease {
  clientId: string
  startedAt: string
  heartbeatAt: string
}

/** 心跳超过该时长视为执行者已失效，允许他人接管 */
export const RUNNER_TIMEOUT_MS = 2 * 60 * 1000

/** 续租间隔：必须远小于 RUNNER_TIMEOUT_MS（后台标签页的定时器会被节流到约 1 分钟） */
export const RUNNER_HEARTBEAT_MS = 30 * 1000

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** 批量队列写回服务端的防抖（队列项进度更新很频繁，必须节流） */
const BATCH_DEBOUNCE_MS = 15_000

function newClientId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `c${random}`
}

/**
 * 页面刷新/崩溃后恢复队列：上次中断时的 processing 项没有任何执行者，
 * 改回 pending 让其可重跑、可删除；currentItemIndex 与 stats 由队列重新推导。
 */
export function restoreBatchQueue(
  persisted: unknown,
  current: BatchProcessingState,
  options: { keepProcessing?: boolean } = {}
): BatchProcessingState {
  if (!persisted) return current
  const p = persisted as Partial<BatchProcessingState>
  // 有活跃执行者时不能把 processing 降级成 pending：否则只读观察者每 60s 轮询一次，
  // 执行者的进度就会被他自己也归零（两边都看不到真实进度）。
  const queue = (Array.isArray(p.queue) ? p.queue : []).map((item) =>
    !options.keepProcessing && item.status === 'processing'
      ? { ...item, status: 'pending' as QueueItemStatus, progress: 0 }
      : item
  )
  const count = (s: QueueItemStatus) => queue.filter((i) => i.status === s).length
  return {
    ...current,
    queue,
    config: p.config ?? current.config,
    isPaused: typeof p.isPaused === 'boolean' ? p.isPaused : current.isPaused,
    isProcessing: options.keepProcessing ? current.isProcessing : false,
    currentItemIndex: options.keepProcessing ? current.currentItemIndex : -1,
    stats: {
      ...current.stats,
      total: queue.length,
      completed: count('completed'),
      failed: count('failed'),
      skipped: count('skipped')
    }
  }
}

/**
 * 批量队列状态管理 Store
 */
export const useBatchQueueStore = create<BatchProcessingState>()(
  (set, get) => ({
      // 初始状态
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      runner: null,
      clientId: newClientId(),
      stats: {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        totalCostUSD: 0,
        totalCostRMB: 0
      },

      // 设置配置
      setConfig: (config) => set({ config }),

      // 添加到队列
      addToQueue: (items) => {
        const newItems: BatchQueueItem[] = items.map((item, index) => ({
          ...item,
          id: `${item.fileName}-${Date.now()}-${index}`,
          status: 'pending' as QueueItemStatus,
          progress: 0
        }))

        set((state) => ({
          queue: [...state.queue, ...newItems],
          stats: {
            ...state.stats,
            total: state.stats.total + newItems.length
          }
        }))
      },

      // 从队列移除
      removeFromQueue: (id) => {
        set((state) => {
          const item = state.queue.find((i) => i.id === id)
          const newQueue = state.queue.filter((i) => i.id !== id)

          let completed = state.stats.completed
          let failed = state.stats.failed
          let skipped = state.stats.skipped
          let total = state.stats.total

          if (item) {
            if (item.status === 'completed') completed--
            else if (item.status === 'failed') failed--
            else if (item.status === 'skipped') skipped--
            total--
          }

          return {
            queue: newQueue,
            stats: { ...state.stats, completed, failed, skipped, total }
          }
        })
      },

      // 清空队列
      clearQueue: () =>
        set({
          queue: [],
          currentItemIndex: -1,
          isProcessing: false,
          isPaused: false,
          stats: {
            total: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            totalCostUSD: 0,
            totalCostRMB: 0
          }
        }),

      // 开始处理
      startProcessing: () => {
        const state = get()
        if (state.queue.length === 0) return
        // 未显式申请租约时补一个（持有者仍是本客户端）
        if (!state.runner || state.runner.clientId !== state.clientId) {
          const now = new Date().toISOString()
          set({ runner: { clientId: state.clientId, startedAt: now, heartbeatAt: now } })
        }

        // 找到第一个待处理的项
        const nextIndex = state.queue.findIndex((i) => i.status === 'pending')

        set({
          isProcessing: true,
          isPaused: false,
          currentItemIndex: nextIndex
        })
      },

      // 暂停处理
      pauseProcessing: () => set({ isPaused: true }),

      // 继续处理
      resumeProcessing: () => set({ isPaused: false }),

      // 停止处理
      stopProcessing: () =>
        set({
          isProcessing: false,
          isPaused: false
        }),

      // 更新项
      updateItem: (id, updates) => {
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          )
        }))
      },

      // 标记项完成
      markItemCompleted: (id, metadata) => {
        set((state) => {
          const item = state.queue.find((i) => i.id === id)
          if (!item) return state

          const newQueue = state.queue.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: 'completed' as QueueItemStatus,
                  progress: 100,
                  endTime: new Date().toISOString(),
                  metadata: { ...i.metadata, ...metadata }
                }
              : i
          )

          return {
            queue: newQueue,
            stats: {
              ...state.stats,
              completed: state.stats.completed + 1,
              totalCostUSD: state.stats.totalCostUSD + (metadata?.costUSD || 0),
              totalCostRMB: state.stats.totalCostRMB + (metadata?.costRMB || 0)
            }
          }
        })
      },

      // 标记项失败
      markItemFailed: (id, error) => {
        set((state) => {
          const item = state.queue.find((i) => i.id === id)
          if (!item) return state

          const newQueue = state.queue.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: 'failed' as QueueItemStatus,
                  error,
                  endTime: new Date().toISOString()
                }
              : i
          )

          return {
            queue: newQueue,
            stats: {
              ...state.stats,
              failed: state.stats.failed + 1
            }
          }
        })
      },

      // 标记项跳过
      markItemSkipped: (id) => {
        set((state) => {
          const item = state.queue.find((i) => i.id === id)
          if (!item) return state

          const newQueue = state.queue.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: 'skipped' as QueueItemStatus,
                  endTime: new Date().toISOString()
                }
              : i
          )

          return {
            queue: newQueue,
            stats: {
              ...state.stats,
              skipped: state.stats.skipped + 1
            }
          }
        })
      },

      // 下一项
      nextItem: () => {
        const state = get()
        if (!state.isProcessing) return

        // 找到下一个待处理的项
        let nextIndex = -1
        for (let i = state.currentItemIndex + 1; i < state.queue.length; i++) {
          if (state.queue[i].status === 'pending') {
            nextIndex = i
            break
          }
        }

        if (nextIndex === -1) {
          // 没有更多待处理项
          set({
            isProcessing: false,
            currentItemIndex: -1
          })
        } else {
          set({ currentItemIndex: nextIndex })
        }
      },

      // 获取下一个待处理项
      getNextPendingItem: () => {
        const state = get()
        const next = state.queue.find((i) => i.status === 'pending')
        return next || null
      },

      // 获取当前项
      getCurrentItem: () => {
        const state = get()
        if (state.currentItemIndex < 0 || state.currentItemIndex >= state.queue.length) {
          return null
        }
        return state.queue[state.currentItemIndex]
      },

      // ===== 执行租约 =====
      isRunnerStale: () => {
        const runner = get().runner
        if (!runner) return true
        const heartbeat = Date.parse(runner.heartbeatAt)
        if (!Number.isFinite(heartbeat)) return true
        return Date.now() - heartbeat > RUNNER_TIMEOUT_MS
      },

      acquireRunner: () => {
        const state = get()
        const runner = state.runner
        const free = !runner || state.isRunnerStale() || runner.clientId === state.clientId
        if (!free) return false
        const now = new Date().toISOString()
        set({
          runner: { clientId: state.clientId, startedAt: runner?.clientId === state.clientId ? runner.startedAt : now, heartbeatAt: now },
        })
        markDirty(BATCH_SECTION, 0)
        get().startHeartbeat()
        return true
      },

      startHeartbeat: () => {
        if (heartbeatTimer !== null) return
        heartbeatTimer = setInterval(() => {
          const state = get()
          if (!state.runner || state.runner.clientId !== state.clientId) {
            get().stopHeartbeat()
            return
          }
          state.heartbeatRunner()
        }, RUNNER_HEARTBEAT_MS)
      },

      stopHeartbeat: () => {
        if (heartbeatTimer === null) return
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      },

      heartbeatRunner: () => {
        const state = get()
        if (!state.runner || state.runner.clientId !== state.clientId) return
        set({ runner: { ...state.runner, heartbeatAt: new Date().toISOString() } })
        markDirty(BATCH_SECTION, 0)
      },

      releaseRunner: () => {
        get().stopHeartbeat()
        if (!get().runner) return
        set({ runner: null })
        markDirty(BATCH_SECTION, 0)
      },

      // 重置统计
      resetStats: () =>
        set({
          stats: {
            total: get().queue.length,
            completed: 0,
            failed: 0,
            skipped: 0,
            totalCostUSD: 0,
            totalCostRMB: 0
          }
        })
  })
)

/** 共享分区 `batch` 的数据形态 */
export interface BatchSectionData {
  queue: BatchQueueItem[]
  config: BatchProcessingConfig | null
  isPaused: boolean
  runner: BatchRunnerLease | null
}

const BATCH_SECTION = 'batch' as const

registerSection<BatchSectionData>(
  BATCH_SECTION,
  {
    getData: () => {
      const { queue, config, isPaused, runner } = useBatchQueueStore.getState()
      return { queue, config, isPaused, runner }
    },
    setData: (data) => {
      const current = useBatchQueueStore.getState()
      const incomingRunner = data?.runner ?? null
      const runnerAlive =
        !!incomingRunner &&
        Number.isFinite(Date.parse(incomingRunner.heartbeatAt)) &&
        Date.now() - Date.parse(incomingRunner.heartbeatAt) <= RUNNER_TIMEOUT_MS

      const restored = restoreBatchQueue(data, current, { keepProcessing: runnerAlive })
      useBatchQueueStore.setState({
        ...restored,
        runner: incomingRunner,
        // 别人的租约有效时不覆盖本地的 clientId
        clientId: current.clientId,
        // 只读观察者不要因为收到别人的 runner 就以为自己在跑
        isProcessing: current.runner?.clientId === current.clientId ? current.isProcessing : false,
        currentItemIndex: current.runner?.clientId === current.clientId ? current.currentItemIndex : -1,
      })
    },
    debounceMs: BATCH_DEBOUNCE_MS,
  },
  { autoWrite: false }
)

// 队列变化（进度更新很频繁）→ 15s 防抖写回服务端
useBatchQueueStore.subscribe((state, prev) => {
  if (
    state.queue !== prev.queue ||
    state.config !== prev.config ||
    state.isPaused !== prev.isPaused ||
    state.runner !== prev.runner
  ) {
    markDirty(BATCH_SECTION)
  }
})

// 选择器hooks
export const useBatchQueue = () => useBatchQueueStore((state) => state.queue)
export const useBatchStats = () => useBatchQueueStore((state) => state.stats)
export const useIsProcessing = () => useBatchQueueStore((state) => state.isProcessing)
export const useIsPaused = () => useBatchQueueStore((state) => state.isPaused)
export const useCurrentItem = () => useBatchQueueStore((state) => 
  state.currentItemIndex >= 0 && state.currentItemIndex < state.queue.length 
    ? state.queue[state.currentItemIndex] 
    : null
)

// 组合选择器（用于需要多个状态的情况）
export const useBatchProcessingStatus = () => {
  const isProcessing = useIsProcessing()
  const isPaused = useIsPaused()
  const currentItem = useCurrentItem()
  
  return {
    isProcessing,
    isPaused,
    currentItem
  }
}
