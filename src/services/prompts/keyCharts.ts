/**
 * 关键图表结构化抽取 Prompt
 * 输出纯 JSON，供 parseCharts + zod 校验
 * 面向多体裁：传记 / 社科 / 自然科学 / 技术等
 */

import keyChartsPrompt from './config/key-charts.md?raw'

export const getKeyChartsPrompt = (): string => keyChartsPrompt.trim()
