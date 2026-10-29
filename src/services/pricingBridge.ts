/**
 * 把共享配置里的「汇率」与「模型价格（models.dev 元数据）」接到元数据格式化器。
 *
 * 用 provider 注入而不是直接 import store：`services/` ←→ `stores/` 互相依赖会形成环。
 */
import { setExchangeRateProvider, setPricingProvider } from './metadataFormatter'
import { useProcessingStore } from '../stores/processing'
import { useAIConfigStore } from '../stores/ai-config'

export function installPricingProviders(): void {
  setExchangeRateProvider(() => useProcessingStore.getState().exchangeRateUsdToCny)

  setPricingProvider((model) => {
    const providers = useAIConfigStore.getState().ai.providers
    for (const provider of providers) {
      const hit = provider.models.find((m) => m.id === model)
      const meta = hit?.meta
      if (meta && typeof meta.inputCost === 'number' && typeof meta.outputCost === 'number') {
        return { input: meta.inputCost, output: meta.outputCost }
      }
    }
    return null
  })
}
