// 处理历史：走共享分区 `history` 的 append 接口（服务端合并，多人同时写不丢）
import { create } from 'zustand'
import { appendToSection, registerSection } from '../../services/shared/sharedState'

export const HISTORY_SECTION = 'history' as const
export const MAX_RECORDS = 200

export interface ProcessingHistoryRecord {
  bookTitle: string
  fileName: string
  completedAt: string
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  model: string
  chapterCount: number
}

export interface HistorySnapshot {
  records: ProcessingHistoryRecord[]
}

export interface ProcessingHistoryState {
  records: ProcessingHistoryRecord[]
  addRecord: (record: Omit<ProcessingHistoryRecord, 'completedAt'>) => void
  /** 本地清空视图（共享历史不清空，避免影响他人） */
  clearLocalView: () => void
  replaceHistory: (data: HistorySnapshot) => void
}

export const useProcessingHistoryStore = create<ProcessingHistoryState>()((set, get) => ({
  records: [],

  addRecord: (record) => {
    const newRecord: ProcessingHistoryRecord = { ...record, completedAt: new Date().toISOString() }
    const filtered = get().records.filter((r) => r.fileName !== record.fileName)
    const records = [newRecord, ...filtered].slice(0, MAX_RECORDS)
    set({ records })
    // 服务端会做同样的去重与前插，这里乐观更新即可
    void appendToSection<HistorySnapshot>(HISTORY_SECTION, { records: [newRecord] })
  },

  clearLocalView: () => set({ records: [] }),

  replaceHistory: (data) =>
    set({ records: Array.isArray(data?.records) ? data.records.slice(0, MAX_RECORDS) : [] }),
}))

registerSection<HistorySnapshot>(
  HISTORY_SECTION,
  {
    getData: () => ({ records: useProcessingHistoryStore.getState().records }),
    setData: (data) => useProcessingHistoryStore.getState().replaceHistory(data),
    debounceMs: 0,
  },
  { autoWrite: false }
)

// 便捷选择器
export const useProcessingHistory = () => useProcessingHistoryStore((state) => state.records)
