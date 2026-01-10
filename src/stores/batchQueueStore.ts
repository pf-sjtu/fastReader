import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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
    chapterCount: number
    processedChapters: number
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
}

/**
 * 批量队列状态管理 Store
 */
export const useBatchQueueStore = create<BatchProcessingState>()(
  persist(
    (set, get) => ({
      // 初始状态
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
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
    }),
    {
      name: 'fastReader-batch-queue',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        queue: state.queue.filter(
          (item) => item.status === 'pending' || item.status === 'processing'
        ),
        config: state.config,
        currentItemIndex: state.currentItemIndex,
        isPaused: state.isPaused
      })
    }
  )
)

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
