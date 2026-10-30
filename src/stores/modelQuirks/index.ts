/**
 * 运行中学到的服务商参数怪癖（真实输出上限 / 参数名 / 不支持温度 / 不支持思考）的后端存档。
 *
 * 学习表本体在 services/ai/outputBudget.ts（模块级，跨 provider 实例）；这里只负责：
 * - 启动 / 同步时把后端 state:modelQuirks 导入学习表 → 所有用户、CLI 共享同一份经验，不必各自再踩一次 400
 * - 学到新值时经 append 接口上报（服务端单调合并：上限只降、旗标只开，并发上报互不覆盖）
 */
import { appendToSection, registerSection } from '../../services/shared/sharedState'
import {
  loadLearnedParams,
  setLearnedParamsPersister,
  type LearnedParams,
} from '../../services/ai/outputBudget'
import { logger } from '../../lib/logger'

export const MODEL_QUIRKS_SECTION = 'modelQuirks'

export interface ModelQuirksSnapshot {
  entries?: Record<string, LearnedParams & { updatedAt?: string }>
}

/** 同一轮里连续学到的多条合并成一次上报 */
const FLUSH_DELAY_MS = 500
let pending: Record<string, LearnedParams> = {}
let timer: ReturnType<typeof setTimeout> | undefined

async function flush(): Promise<void> {
  timer = undefined
  const entries = pending
  pending = {}
  if (Object.keys(entries).length === 0) return
  try {
    await appendToSection<ModelQuirksSnapshot>(MODEL_QUIRKS_SECTION, { entries })
  } catch (error) {
    // 未登录等情况：本会话内学习表仍生效，只是没存档；下次学到时再上报
    logger.warn('[model-quirks] 上报失败，仅本会话生效:', error)
  }
}

setLearnedParamsPersister((entries) => {
  for (const [key, patch] of Object.entries(entries)) {
    pending[key] = { ...pending[key], ...patch }
  }
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
})

registerSection<ModelQuirksSnapshot>(
  MODEL_QUIRKS_SECTION,
  {
    // 学习表只增不减，由服务端合并；本地不作为写入来源（autoWrite: false）
    getData: () => ({}),
    setData: (data) => loadLearnedParams(data?.entries),
    debounceMs: 0,
  },
  { autoWrite: false }
)

/** 测试用：立即发出待上报的条目 */
export async function __flushModelQuirks(): Promise<void> {
  if (timer) clearTimeout(timer)
  await flush()
}
