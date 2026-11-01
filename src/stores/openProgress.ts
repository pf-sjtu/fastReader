import { create } from 'zustand'
import type { DownloadProgress } from '@/services/webdav/progress'

/** 打开一本书的三个阶段：连上 WebDAV（可能要等扫描）→ 下载 → 解析章节 */
export type OpenPhase = 'connecting' | 'downloading' | 'parsing'

export interface OpenProgress {
  /** 书架条目路径（卡片据此认出「是我在打开」） */
  path: string
  title: string
  phase: OpenPhase
  progress: DownloadProgress | null
  /** 下载中很久没有新数据：提示「连接较慢，仍在等待」，让用户知道没卡死 */
  stalled: boolean
}

interface OpenProgressState {
  current: OpenProgress | null
  /** 当前下载的取消函数；null = 不可取消（连接 / 解析阶段） */
  cancel: (() => void) | null
  start: (path: string, title: string) => void
  update: (patch: Partial<Omit<OpenProgress, 'path' | 'title'>>) => void
  setCancel: (cancel: (() => void) | null) => void
  clear: () => void
}

export const useOpenProgress = create<OpenProgressState>()((set, get) => ({
  current: null,
  cancel: null,
  start: (path, title) => set({ current: { path, title, phase: 'connecting', progress: null, stalled: false }, cancel: null }),
  update: (patch) => {
    const cur = get().current
    if (cur) set({ current: { ...cur, ...patch } })
  },
  setCancel: (cancel) => set({ cancel }),
  clear: () => set({ current: null, cancel: null }),
}))
