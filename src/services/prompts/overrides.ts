/**
 * 提示词覆盖项：只保存「与内置默认值不同」的条目。
 *
 * 好处：内置模板升级后，用户没改过的条目自动跟随新默认值，而不是被旧副本钉死。
 */
import type { PromptConfig } from '../../types/ai'
import type { PromptOverrides } from '../../stores/types'

const isNonEmptyDiff = (value: string | undefined, base: string): boolean =>
  typeof value === 'string' && value !== base

/** 由「完整配置」与「内置默认」求覆盖项 */
export function diffPromptOverrides(
  custom: Partial<PromptConfig> | undefined,
  defaults: PromptConfig
): PromptOverrides {
  if (!custom) return {}
  const out: PromptOverrides = {}

  const chapterSummary: NonNullable<PromptOverrides['chapterSummary']> = {}
  if (isNonEmptyDiff(custom.chapterSummary?.fiction, defaults.chapterSummary.fiction)) {
    chapterSummary.fiction = custom.chapterSummary!.fiction
  }
  if (isNonEmptyDiff(custom.chapterSummary?.nonFiction, defaults.chapterSummary.nonFiction)) {
    chapterSummary.nonFiction = custom.chapterSummary!.nonFiction
  }
  if (Object.keys(chapterSummary).length > 0) out.chapterSummary = chapterSummary

  const mindmap: NonNullable<PromptOverrides['mindmap']> = {}
  for (const key of ['chapter', 'arrow', 'combined'] as const) {
    if (isNonEmptyDiff(custom.mindmap?.[key], defaults.mindmap[key])) {
      mindmap[key] = custom.mindmap![key]
    }
  }
  if (Object.keys(mindmap).length > 0) out.mindmap = mindmap

  if (isNonEmptyDiff(custom.connectionAnalysis, defaults.connectionAnalysis)) {
    out.connectionAnalysis = custom.connectionAnalysis
  }
  if (isNonEmptyDiff(custom.overallSummary, defaults.overallSummary)) {
    out.overallSummary = custom.overallSummary
  }

  return out
}

/** 合并「内置默认」与「覆盖项」得到实际使用的完整配置 */
export function mergePromptOverrides(
  defaults: PromptConfig,
  overrides: PromptOverrides | undefined
): PromptConfig {
  if (!overrides) return { ...defaults }
  return {
    chapterSummary: {
      fiction: overrides.chapterSummary?.fiction ?? defaults.chapterSummary.fiction,
      nonFiction: overrides.chapterSummary?.nonFiction ?? defaults.chapterSummary.nonFiction
    },
    mindmap: {
      chapter: overrides.mindmap?.chapter ?? defaults.mindmap.chapter,
      arrow: overrides.mindmap?.arrow ?? defaults.mindmap.arrow,
      combined: overrides.mindmap?.combined ?? defaults.mindmap.combined
    },
    connectionAnalysis: overrides.connectionAnalysis ?? defaults.connectionAnalysis,
    overallSummary: overrides.overallSummary ?? defaults.overallSummary
  }
}

/** 某个条目是否被覆盖（用于编辑器显示「已自定义」） */
export function isPromptOverridden(
  overrides: PromptOverrides | undefined,
  path:
    | { group: 'chapterSummary'; key: 'fiction' | 'nonFiction' }
    | { group: 'mindmap'; key: 'chapter' | 'arrow' | 'combined' }
    | { group: 'connectionAnalysis' }
    | { group: 'overallSummary' }
): boolean {
  if (!overrides) return false
  if (path.group === 'connectionAnalysis') return typeof overrides.connectionAnalysis === 'string'
  if (path.group === 'overallSummary') return typeof overrides.overallSummary === 'string'
  if (path.group === 'chapterSummary') return typeof overrides.chapterSummary?.[path.key] === 'string'
  return typeof overrides.mindmap?.[path.key] === 'string'
}

/** 是否有任何覆盖项 */
export function hasPromptOverrides(overrides: PromptOverrides | undefined): boolean {
  if (!overrides) return false
  const { chapterSummary, mindmap, connectionAnalysis, overallSummary } = overrides
  return (
    Object.keys(chapterSummary ?? {}).length > 0 ||
    Object.keys(mindmap ?? {}).length > 0 ||
    typeof connectionAnalysis === 'string' ||
    typeof overallSummary === 'string'
  )
}
