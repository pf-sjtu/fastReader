import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ProcessingHistoryRecord {
  bookTitle: string
  fileName: string
  completedAt: string
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  model: string
  chapterCount: number
}

const MAX_RECORDS = 10

export interface ProcessingHistoryState {
  records: ProcessingHistoryRecord[]
  addRecord: (record: Omit<ProcessingHistoryRecord, 'completedAt'>) => void
  clearHistory: () => void
}

export const useProcessingHistoryStore = create<ProcessingHistoryState>()(
  persist(
    (set) => ({
      records: [],

      addRecord: (record) =>
        set((state) => {
          const newRecord: ProcessingHistoryRecord = {
            ...record,
            completedAt: new Date().toISOString()
          }
          // 去重：同一 fileName 只保留最新记录
          const filtered = state.records.filter((r) => r.fileName !== record.fileName)
          return {
            records: [newRecord, ...filtered].slice(0, MAX_RECORDS)
          }
        }),

      clearHistory: () => set({ records: [] })
    }),
    {
      name: 'ebook-processing-history'
    }
  )
)
