// 思维导图默认 prompt（用户未配置时的兜底，取 v1 YAML 模板）
import { getMindmapPrompt } from './config/promptLoader'

export const getChapterMindMapPrompt = (): string => getMindmapPrompt('v1', 'chapter')

export const getMindMapArrowPrompt = (): string => getMindmapPrompt('v1', 'arrow')

export const getCombinedMindMapPrompt = (): string => getMindmapPrompt('v1', 'combined')
