// AI 连接测试：按「服务商 + 模型」构造运行时配置（不含明文密钥，由服务端代理注入），默认测当前模型
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIService, type AIProviderConfig } from '../../../services/ai'
import type { AIServiceOptions } from '../../../stores/types'
import { hasPendingSecret, useAIConfigStore } from '../../../stores/ai-config'
import { flushSection } from '../../../services/shared/sharedState'

export interface ConnectionTestResult {
  success: boolean
  message: string
}

export interface ConnectionTestTarget {
  providerId: string
  modelId: string
}

/** 由 store 中的服务商/模型构造运行时配置；找不到时返回 null */
export function buildRuntimeConfig(target?: ConnectionTestTarget): AIProviderConfig | null {
  const { ai } = useAIConfigStore.getState()
  const { providerId, modelId } = target ?? ai.active
  const provider = ai.providers.find((p) => p.id === providerId)
  const model = provider?.models.find((m) => m.id === modelId)
  if (!provider || !model) return null
  return {
    provider: provider.type,
    providerId: provider.id,
    apiUrl: provider.baseUrl,
    model: model.id,
    temperature: model.temperature ?? ai.defaultTemperature,
  }
}

export function useAIConnectionTest() {
  const { t } = useTranslation()
  const [isTesting, setIsTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  // 只采纳最后一次测试的结果（连续点击时旧请求晚返回不覆盖新结果）
  const seqRef = useRef(0)

  const test = useCallback(
    async (target?: ConnectionTestTarget, options?: AIServiceOptions): Promise<ConnectionTestResult> => {
      const config = buildRuntimeConfig(target)
      const provider = config?.providerId ? useAIConfigStore.getState().getProvider(config.providerId) : undefined
      if (!config || !config.model) {
        const r = { success: false, message: t('config.connection.selectModelFirst') }
        setResult(r)
        return r
      }
      if (provider && provider.type !== 'ollama' && !provider.apiKey?.hasSecret) {
        const r = { success: false, message: t('config.connection.enterApiKeyFirst') }
        setResult(r)
        return r
      }

      const seq = ++seqRef.current
      setIsTesting(true)
      setResult(null)
      let r: ConnectionTestResult
      try {
        // 新填的密钥还没写回：服务端代理拿不到，先提交
        if (config.providerId && hasPendingSecret(config.providerId)) await flushSection('ai')
        // testConnection 返回 { success, error }（对象恒为 truthy，不能直接当布尔用）
        const { success, error } = await new AIService(config, undefined, options).testConnection()
        r = {
          success,
          message: success
            ? t('config.connection.aiSuccess')
            : error
              ? `${t('config.connection.aiFailed')}: ${error}`
              : t('config.connection.aiFailed'),
        }
      } catch (error) {
        r = {
          success: false,
          message: t('config.connection.testFailed', {
            error: error instanceof Error ? error.message : t('config.connection.unknownError'),
          }),
        }
      }
      if (seq === seqRef.current) {
        setResult(r)
        setIsTesting(false)
      }
      return r
    },
    [t]
  )

  const reset = useCallback(() => setResult(null), [])

  return { isTesting, result, test, reset }
}
