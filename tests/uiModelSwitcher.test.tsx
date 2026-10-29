/**
 * 状态栏模型切换器 + 「未配置 API Key」误报回归。
 *
 * 误报原因：密钥只存服务端后，运行时视图里不再有明文 apiKey，旧代码却仍用 `aiConfig.apiKey` 判断，
 * 导致已配置密钥的服务商也显示「未配置 API Key」。现在改看 hasCredentials（服务端 {hasSecret}）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, flush, stubDomForRadix, type Mounted } from './uiTestUtils'
import { ModelSwitcher } from '../src/components/ModelSwitcher'
import { computeAIConfig, useAIConfigStore } from '../src/stores/ai-config'
import type { AIState } from '../src/types/ai'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)

const state = (hasSecret: boolean): AIState => ({
  providers: [
    {
      id: 'minimax',
      name: 'MiniMax',
      type: 'openai',
      baseUrl: 'https://api.minimaxi.com/v1',
      ...(hasSecret ? { apiKey: { hasSecret: true } } : {}),
      models: [
        { id: 'MiniMax-M3.1-Flash', enabled: true, source: 'auto', meta: { context: 1000000, reasoning: true } },
        { id: 'MiniMax-M3', enabled: true, source: 'auto' },
        { id: 'hidden', enabled: false, source: 'auto' },
      ],
    },
  ],
  active: { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash' },
  defaultTemperature: 0.7,
})

let m: Mounted | null = null
beforeEach(() => stubDomForRadix())
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

describe('hasCredentials（运行时视图不含明文密钥）', () => {
  it('服务端已保存密钥 → hasCredentials=true，即使客户端拿不到 apiKey', () => {
    const cfg = computeAIConfig(state(true))
    expect(cfg.apiKey).toBeUndefined()
    expect(cfg.hasCredentials).toBe(true)
  })

  it('未保存密钥 → false；Ollama 不需要密钥 → true', () => {
    expect(computeAIConfig(state(false)).hasCredentials).toBe(false)
    const ollama = state(false)
    ollama.providers[0] = { ...ollama.providers[0], type: 'ollama' }
    expect(computeAIConfig(ollama).hasCredentials).toBe(true)
  })
})

describe('ModelSwitcher', () => {
  it('已配置密钥：显示当前模型而不是「未配置 API Key」', () => {
    useAIConfigStore.getState().replaceAI(state(true))
    m = mount(<ModelSwitcher />)
    expect(m.container.textContent).toContain('MiniMax-M3.1-Flash')
    expect(m.container.textContent).not.toContain(t('statusBar.noApiKey'))
  })

  it('未配置密钥：触发器提示未配置', () => {
    useAIConfigStore.getState().replaceAI(state(false))
    m = mount(<ModelSwitcher />)
    expect(m.container.textContent).toContain(t('statusBar.noApiKey'))
  })

  it('展开后可切换模型与思考强度；只列启用的模型', async () => {
    useAIConfigStore.getState().replaceAI(state(true))
    m = mount(<ModelSwitcher />)
    const trigger = m.container.querySelector('button')!
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false, pointerType: 'mouse' }))
    await flush()

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('MiniMax-M3.1-Flash'), expect.stringContaining('MiniMax-M3')])

    click(options[1])
    expect(useAIConfigStore.getState().ai.active.modelId).toBe('MiniMax-M3')

    const high = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => b.textContent === t('modelSwitcher.effort.high')
    )
    click(high)
    expect(useAIConfigStore.getState().ai.reasoningEffort).toBe('high')
    expect(useAIConfigStore.getState().aiConfig.reasoningEffort).toBe('high')
  })
})
