/**
 * 用量 store（对应共享分区 `usage`，只走 append 接口）。
 *
 * Token 用量与费用是全员累计值：AI 每调一次就写 KV 会打爆免费额度（1000 写/天），
 * 所以本地累加，30 秒或「一本书处理结束」时合并提交一次。
 */
import { create } from 'zustand'
import { appendToSection, registerSection } from '../../services/shared/sharedState'

export const USAGE_SECTION = 'usage' as const
const FLUSH_INTERVAL_MS = 30_000

export interface UsageSnapshot {
  tokenUsage: number
  totalCostUSD: number
  byModel: Record<string, { tokens: number; costUSD: number }>
}

const EMPTY_USAGE: UsageSnapshot = { tokenUsage: 0, totalCostUSD: 0, byModel: {} }

/** 尚未提交的增量 */
let pending: UsageSnapshot = { ...EMPTY_USAGE, byModel: {} }
let flushTimer: ReturnType<typeof setTimeout> | null = null

function addInto(target: UsageSnapshot, tokens: number, costUSD: number, model?: string) {
  target.tokenUsage += tokens
  target.totalCostUSD += costUSD
  if (model) {
    const prev = target.byModel[model] ?? { tokens: 0, costUSD: 0 }
    target.byModel[model] = { tokens: prev.tokens + tokens, costUSD: prev.costUSD + costUSD }
  }
}

function hasPendingUsage(): boolean {
  return (
    pending.tokenUsage > 0 ||
    pending.totalCostUSD > 0 ||
    Object.values(pending.byModel).some((v) => v.tokens > 0 || v.costUSD > 0)
  )
}

export interface UsageState extends UsageSnapshot {
  /** 累加并安排提交 */
  addTokenUsage: (tokens: number, costUSD?: number, model?: string) => void
  /** 立即提交增量 */
  flushUsage: () => Promise<void>
  /** 仅本地清零（不再服务端清零：累计值属于全员共享） */
  resetTokenUsage: () => void
  replaceUsage: (data: UsageSnapshot) => void
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  ...EMPTY_USAGE,

  addTokenUsage: (tokens, costUSD = 0, model) => {
    if (tokens <= 0 && costUSD <= 0) return
    const state = get()
    const byModel = { ...state.byModel }
    const prev = model ? byModel[model] ?? { tokens: 0, costUSD: 0 } : null
    if (model && prev) {
      byModel[model] = { tokens: prev.tokens + tokens, costUSD: prev.costUSD + costUSD }
    }
    set({
      tokenUsage: state.tokenUsage + tokens,
      totalCostUSD: state.totalCostUSD + costUSD,
      byModel,
    })

    addInto(pending, tokens, costUSD, model)
    // 首次有待提交增量时启动定时提交
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        void get().flushUsage()
      }, FLUSH_INTERVAL_MS)
    }
  },

  flushUsage: async () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!hasPendingUsage()) return
    const patch = pending
    pending = { ...EMPTY_USAGE, byModel: {} }
    const result = await appendToSection<UsageSnapshot>(USAGE_SECTION, patch)
    if (result) {
      set({
        tokenUsage: result.tokenUsage ?? get().tokenUsage,
        totalCostUSD: result.totalCostUSD ?? get().totalCostUSD,
        byModel: result.byModel ?? get().byModel,
      })
    } else {
      // 提交失败：把增量放回去，下次再试
      addInto(pending, patch.tokenUsage, patch.totalCostUSD)
      for (const [model, value] of Object.entries(patch.byModel)) {
        const prev = pending.byModel[model] ?? { tokens: 0, costUSD: 0 }
        pending.byModel[model] = {
          tokens: prev.tokens + value.tokens,
          costUSD: prev.costUSD + value.costUSD,
        }
      }
    }
  },

  resetTokenUsage: () => set({ ...EMPTY_USAGE, byModel: {} }),

  replaceUsage: (data) =>
    set({
      tokenUsage: Number(data?.tokenUsage) || 0,
      totalCostUSD: Number(data?.totalCostUSD) || 0,
      byModel: data?.byModel ?? {},
    }),
}))

registerSection<UsageSnapshot>(
  USAGE_SECTION,
  {
    // usage 节只通过 append 写入，这里的 getData 仅用于「无变化判定」
    getData: () => {
      const { tokenUsage, totalCostUSD, byModel } = useUsageStore.getState()
      return { tokenUsage, totalCostUSD, byModel }
    },
    setData: (data) => useUsageStore.getState().replaceUsage(data),
    debounceMs: 0,
  },
  { autoWrite: false }
)

// 便捷选择器
export const useTokenUsage = () => useUsageStore((state) => state.tokenUsage)
export const useTotalCostUSD = () => useUsageStore((state) => state.totalCostUSD)
