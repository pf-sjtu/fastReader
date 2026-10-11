// 思维导图默认 prompt（用户未配置时的兜底，取默认版本 YAML 模板）
import { getMindmapPrompt } from './config/promptLoader'
import { DEFAULT_PROMPT_VERSION } from './templates'

export const getChapterMindMapPrompt = (): string => getMindmapPrompt(DEFAULT_PROMPT_VERSION, 'chapter')

export const getMindMapArrowPrompt = (): string => getMindmapPrompt(DEFAULT_PROMPT_VERSION, 'arrow')

export const getCombinedMindMapPrompt = (): string => getMindmapPrompt(DEFAULT_PROMPT_VERSION, 'combined')
