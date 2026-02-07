import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIService } from '../../src/services/aiService'

describe('AIService', () => {
  const mockConfig = {
    provider: 'openai' as const,
    apiKey: 'test-api-key',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    temperature: 0.7
  }

  describe('constructor', () => {
    it('should initialize with config', () => {
      const service = new AIService(mockConfig)
      expect(service).toBeDefined()
    })
  })

  describe('extractErrorContent', () => {
    it('should extract message from error body', () => {
      const service = new AIService(mockConfig)
      const error = {
        body: JSON.stringify({ error: { message: 'Test error' } })
      }
      const result = (service as any).extractErrorContent(error)
      expect(result).toBe('Test error')
    })

    it('should handle plain error message', () => {
      const service = new AIService(mockConfig)
      const error = { message: 'Plain error' }
      const result = (service as any).extractErrorContent(error)
      expect(result).toBe('Plain error')
    })

    it('should return default for unknown error', () => {
      const service = new AIService(mockConfig)
      const result = (service as any).extractErrorContent(null)
      expect(result).toBe('未知错误')
    })
  })

  describe('recordTokenUsage', () => {
    it('should record token usage', () => {
      const service = new AIService(mockConfig)
      const callback = vi.fn()
      
      service.setOnTokenUsage(callback)
      ;(service as any).recordTokenUsage(100)
      
      expect(callback).toHaveBeenCalledWith(100)
    })
  })
})
