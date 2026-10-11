// AI 连接测试：ConfigDialog（当前配置）与 AIProviderConfig（编辑中的服务商）共用
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIService, type AIProviderConfig } from '../../../services/aiService'
import type { AIServiceOptions } from '../../../stores/types'

export interface ConnectionTestResult {
  success: boolean
  message: string
}

export function useAIConnectionTest() {
  const { t } = useTranslation()
  const [isTesting, setIsTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  // 只采纳最后一次测试的结果（连续点击时旧请求晚返回不覆盖新结果）
  const seqRef = useRef(0)

  const test = useCallback(
    async (config: AIProviderConfig, options?: AIServiceOptions): Promise<ConnectionTestResult> => {
      if (!config.apiKey) {
        const r = { success: false, message: t('config.connection.enterApiKeyFirst') }
        setResult(r)
        return r
      }
      const seq = ++seqRef.current
      setIsTesting(true)
      setResult(null)
      let r: ConnectionTestResult
      try {
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
