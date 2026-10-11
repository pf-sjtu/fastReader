// AI 服务商列表 / 编辑对话框共用的纯函数
import type { AIProviderConfig } from '../../../stores/types'

export const EMPTY_PROVIDER_FORM: Partial<AIProviderConfig> = {
  provider: 'gemini',
  apiKey: '',
  apiUrl: '',
  model: '',
  temperature: 0.7,
  proxyUrl: '',
  proxyEnabled: false,
  customFields: {},
}

/** 从 apiUrl 和 model 派生显示名称：hostname/model；URL 非法时只显示 model */
export function getDisplayName(apiUrl: string, model: string): string {
  try {
    return `${new URL(apiUrl).hostname}/${model}`
  } catch {
    return model
  }
}

/** 去重键：规范化 URL（host + path）+ model */
export function getUniqueKey(apiUrl: string, model: string): string {
  try {
    const url = new URL(apiUrl)
    return `${url.hostname}${url.pathname}/${model}`
  } catch {
    return `${apiUrl}/${model}`
  }
}

/** 是否与已有服务商重复（exclude 为正在编辑的那一项） */
export function isDuplicateProvider(
  providers: AIProviderConfig[],
  apiUrl: string,
  model: string,
  exclude?: AIProviderConfig
): boolean {
  const key = getUniqueKey(apiUrl, model)
  return providers.some((p) => p !== exclude && getUniqueKey(p.apiUrl, p.model) === key)
}

/** 表单 → 完整配置（缺省字段补默认值） */
export function toProviderConfig(form: Partial<AIProviderConfig>): AIProviderConfig {
  return {
    provider: form.provider as AIProviderConfig['provider'],
    apiKey: form.apiKey || '',
    apiUrl: form.apiUrl || '',
    model: form.model || '',
    temperature: form.temperature || 0.7,
    proxyUrl: form.proxyUrl || '',
    proxyEnabled: form.proxyEnabled || false,
    customFields: form.customFields || {},
  }
}
