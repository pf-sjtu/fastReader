/**
 * 扁平目录层级还原的接线：把「处理阶段同一套 AI 配置」包成 EpubProcessor 需要的 resolveLevels，
 * 并按「目录文本 + 模型 + 提示词」缓存结果——同一本书重复预览 / 处理只会问一次模型。
 *
 * 算法能判定的书零成本；只有算法拿不准（见 inferOutline 的 llmCandidate）才会走到这里。
 * 没有可用凭据、模型报错、结果不合格都静默放弃（调用方退回算法结果或保持扁平），绝不阻断提取。
 */
import { AIService } from '@/services/ai'
import { cacheService, CACHE_KEY_PREFIX } from '@/services/cacheService'
import { canHash, sha256Hex, CACHE_SCHEMA_VERSION } from '@/services/pipeline/cacheKeys'
import { getTocLevelsPrompt } from '@/services/prompts'
import { useConfigStore } from '@/stores/configStore'
import { logger } from '@/lib/logger'
import { outlineCacheInput, refineWithLlm } from './tocOutline'
import type { TocRestructureOptions } from '@/services/epubProcessor'

/** 能还原层级的处理器（目前只有 EpubProcessor；PDF 等没有这个方法） */
export interface TocRestructurable {
  configureTocRestructure(options: TocRestructureOptions): void
}

const hasTocRestructure = (p: unknown): p is TocRestructurable =>
  typeof (p as TocRestructurable | null)?.configureTocRestructure === 'function'

async function cacheKeyFor(model: string, labels: string[]): Promise<string | null> {
  if (!canHash()) return null
  const digest = await sha256Hex(
    JSON.stringify([CACHE_SCHEMA_VERSION, 'toc-levels', model, getTocLevelsPrompt(), outlineCacheInput(labels)])
  )
  return `${CACHE_KEY_PREFIX}toc-levels:${digest.slice(0, 40)}`
}

/** 用当前 AI 配置判层级；没有可用服务商返回 null（表示「不用 LLM」） */
export function createTocLevelResolver(): TocRestructureOptions['resolveLevels'] | undefined {
  const { aiConfig } = useConfigStore.getState()
  if (!aiConfig.model || aiConfig.hasCredentials === false) return undefined

  return async (labels, signal) => {
    const { aiConfig: cfg, aiServiceOptions } = useConfigStore.getState()
    const modelId = `${cfg.providerId ?? cfg.provider}/${cfg.model}`
    const key = await cacheKeyFor(modelId, labels)
    if (key) {
      const hit = await cacheService.get<number[]>(key)
      if (Array.isArray(hit) && hit.length === labels.length) return hit
    }

    const ai = new AIService(
      { ...cfg },
      () => useConfigStore.getState().promptConfig,
      { maxRetries: aiServiceOptions.maxRetries, baseRetryDelay: aiServiceOptions.baseRetryDelay }
    )
    const levels = await refineWithLlm(labels, (entries, prior) => ai.refineTocLevels(entries, prior, { signal }), signal)
    if (levels && key) await cacheService.set(key, levels)
    else if (!levels) logger.warn('[toc] LLM 目录层级结果不合格，保持算法结果')
    return levels
  }
}

/**
 * 按处理选项给处理器配好目录还原；非 EPUB 处理器直接忽略。
 * enabled=false 时恢复旧行为（扁平目录逐条成章）。
 */
export function applyTocRestructure(processor: unknown, enabled: boolean, signal?: AbortSignal): void {
  if (!hasTocRestructure(processor)) return
  processor.configureTocRestructure({
    enabled,
    resolveLevels: enabled ? createTocLevelResolver() : undefined,
    signal,
  })
}
