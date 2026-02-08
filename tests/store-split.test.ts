/**
 * Store拆分验证测试
 * 验证新的子store和兼容壳store功能一致
 */
import { describe, it, expect, beforeEach } from 'vitest'

// 子store
import { useAIConfigStore, computeAIConfig } from '../src/stores/ai-config'
import { useProcessingStore } from '../src/stores/processing'
import { useWebDAVStore } from '../src/stores/webdav'
import { usePromptStore } from '../src/stores/prompts'
import { useCoreStore } from '../src/stores/core'

// 兼容壳store
import { useConfigStore } from '../src/stores/configStore'

describe('Store Split Verification', () => {
  beforeEach(() => {
    // 重置所有store
    useAIConfigStore.setState(useAIConfigStore.getInitialState?.() || {})
    useProcessingStore.setState(useProcessingStore.getInitialState?.() || {})
    useWebDAVStore.setState(useWebDAVStore.getInitialState?.() || {})
    usePromptStore.setState(usePromptStore.getInitialState?.() || {})
    useCoreStore.setState(useCoreStore.getInitialState?.() || {})
  })

  describe('AI Config Store', () => {
    it('should add AI provider', () => {
      const store = useAIConfigStore.getState()
      const initialCount = store.aiConfigManager.providers.length

      const newIndex = store.addAIProvider({
        provider: 'openai',
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4',
        temperature: 0.5
      })

      expect(newIndex).toBe(initialCount + 1)
      expect(useAIConfigStore.getState().aiConfigManager.providers.length).toBe(initialCount + 1)
    })

    it('should update AI provider', () => {
      const store = useAIConfigStore.getState()
      store.updateAIProvider(1, { model: 'gpt-4-turbo' })

      const provider = store.getActiveAIProvider()
      expect(provider?.model).toBe('gpt-4-turbo')
    })

    it('should switch current model', () => {
      const store = useAIConfigStore.getState()

      // 添加第二个provider
      store.addAIProvider({
        provider: 'openai',
        apiKey: 'key2',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5',
        temperature: 0.7
      })

      // 切换到第二个
      store.setCurrentModelId(2)
      expect(useAIConfigStore.getState().aiConfigManager.currentModelId).toBe(2)
    })
  })

  describe('Processing Store', () => {
    it('should update processing mode', () => {
      const store = useProcessingStore.getState()
      store.setProcessingMode('summary')

      expect(useProcessingStore.getState().processingOptions.processingMode).toBe('summary')
    })

    it('should update book type', () => {
      const store = useProcessingStore.getState()
      store.setBookType('fiction')

      expect(useProcessingStore.getState().processingOptions.bookType).toBe('fiction')
    })
  })

  describe('WebDAV Store', () => {
    it('should update WebDAV config', () => {
      const store = useWebDAVStore.getState()
      store.setWebDAVEnabled(true)
      store.setWebDAVServerUrl('https://example.com/dav')

      const config = useWebDAVStore.getState().webdavConfig
      expect(config.enabled).toBe(true)
      expect(config.serverUrl).toBe('https://example.com/dav')
    })
  })

  describe('Core Store', () => {
    it('should track token usage', () => {
      const store = useCoreStore.getState()
      store.addTokenUsage(100)
      store.addTokenUsage(50)

      expect(useCoreStore.getState().tokenUsage).toBe(150)
    })

    it('should update retry options', () => {
      const store = useCoreStore.getState()
      store.setMaxRetries(5)

      expect(useCoreStore.getState().aiServiceOptions.maxRetries).toBe(5)
    })
  })

  describe('Compatibility Shell', () => {
    it('should have same ConfigState interface', () => {
      // 验证兼容壳具有完整的ConfigState接口
      const compatStore = useConfigStore.getState()

      // 核心状态
      expect(compatStore.aiConfigManager).toBeDefined()
      expect(compatStore.aiConfig).toBeDefined()
      expect(compatStore.processingOptions).toBeDefined()
      expect(compatStore.webdavConfig).toBeDefined()
      expect(compatStore.promptConfig).toBeDefined()
      expect(compatStore.tokenUsage).toBeDefined()

      // AI配置方法
      expect(typeof compatStore.setModel).toBe('function')
      expect(typeof compatStore.addAIProvider).toBe('function')
      expect(typeof compatStore.updateAIProvider).toBe('function')
      expect(typeof compatStore.getActiveAIProvider).toBe('function')

      // 处理选项方法
      expect(typeof compatStore.setProcessingMode).toBe('function')
      expect(typeof compatStore.setBookType).toBe('function')

      // WebDAV方法
      expect(typeof compatStore.setWebDAVEnabled).toBe('function')

      // Token追踪
      expect(typeof compatStore.addTokenUsage).toBe('function')

      // 导入导出
      expect(typeof compatStore.exportConfig).toBe('function')
      expect(typeof compatStore.importConfig).toBe('function')
    })

    it('should maintain same selector API', () => {
      // 这些选择器应该正常工作
      const aiConfig = useConfigStore.getState().aiConfig
      const processingOptions = useConfigStore.getState().processingOptions
      const webdavConfig = useConfigStore.getState().webdavConfig
      const tokenUsage = useConfigStore.getState().tokenUsage

      expect(aiConfig).toBeDefined()
      expect(processingOptions).toBeDefined()
      expect(webdavConfig).toBeDefined()
      expect(typeof tokenUsage).toBe('number')
    })
  })

  describe('computeAIConfig helper', () => {
    it('should compute AI config from manager', () => {
      const manager = useAIConfigStore.getState().aiConfigManager
      const config = computeAIConfig(manager)

      expect(config.provider).toBeDefined()
      expect(config.apiKey).toBeDefined()
      expect(config.model).toBeDefined()
    })
  })
})
