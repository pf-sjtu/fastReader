/**
 * 阅读工作台的 UI 状态：对照栏页签/宽度、聚焦实体、标注开关等。
 * 只有偏好写 localStorage（浏览器级记忆）；聚焦实体是瞬时状态不持久化。
 * 当前阅读章不放这里——它由 scroll spy（currentViewingChapterSummary）单一来源提供。
 */
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type CompanionTab =
  | 'graph'
  | 'timeline'
  | 'people'
  | 'overall'
  | 'ask'
  | 'quiz'
  | 'notes'
  | 'source'

export const COMPANION_MIN_WIDTH = 280
export const COMPANION_MAX_WIDTH = 760
export const COMPANION_DEFAULT_WIDTH = 440

export function clampCompanionWidth(w: number): number {
  if (!Number.isFinite(w)) return COMPANION_DEFAULT_WIDTH
  return Math.min(COMPANION_MAX_WIDTH, Math.max(COMPANION_MIN_WIDTH, Math.round(w)))
}

/** 隐私模式 / 配额满时 localStorage 会抛错：吞掉，界面照常工作只是不记忆 */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

interface ReadingFocusState {
  focusedEntityId: string | null
  companionTab: CompanionTab
  companionOpen: boolean
  companionWidth: number
  /** 正文实体标注开关 */
  annotateEntities: boolean
  /** 图谱「截至本章」渐进模式 */
  progressiveGraph: boolean
  /** 专注模式：收起目录与对照栏（会话内状态，不持久化） */
  focusMode: boolean

  /** 聚焦实体；reveal（默认）会同时展开对照栏并切到图谱，并退出专注模式 */
  focusEntity: (id: string | null, opts?: { reveal?: boolean }) => void
  setCompanionTab: (tab: CompanionTab) => void
  setCompanionOpen: (open: boolean) => void
  setCompanionWidth: (width: number) => void
  setAnnotateEntities: (on: boolean) => void
  setProgressiveGraph: (on: boolean) => void
  toggleFocusMode: () => void
}

export const useReadingFocusStore = create<ReadingFocusState>()(
  persist(
    (set) => ({
      focusedEntityId: null,
      companionTab: 'graph',
      companionOpen: true,
      companionWidth: COMPANION_DEFAULT_WIDTH,
      annotateEntities: true,
      progressiveGraph: false,
      focusMode: false,

      focusEntity: (id, opts) =>
        set(
          id && opts?.reveal !== false
            ? { focusedEntityId: id, companionTab: 'graph', companionOpen: true, focusMode: false }
            : { focusedEntityId: id }
        ),
      setCompanionTab: (companionTab) => set({ companionTab }),
      setCompanionOpen: (companionOpen) => set({ companionOpen }),
      setCompanionWidth: (w) => set({ companionWidth: clampCompanionWidth(w) }),
      setAnnotateEntities: (annotateEntities) => set({ annotateEntities }),
      setProgressiveGraph: (progressiveGraph) => set({ progressiveGraph }),
      toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    }),
    {
      name: 'juhua.readingFocus.v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        companionTab: s.companionTab,
        companionOpen: s.companionOpen,
        companionWidth: s.companionWidth,
        annotateEntities: s.annotateEntities,
        progressiveGraph: s.progressiveGraph,
      }),
      // 存档里的宽度可能被手改或来自旧版本：载入时再夹一次
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ReadingFocusState>
        return {
          ...current,
          ...p,
          companionWidth: clampCompanionWidth(p.companionWidth ?? current.companionWidth),
        }
      },
    }
  )
)
