import { describe, it, expect } from 'vitest'
import { AIService, SKIPPED_SUMMARY_PREFIX } from '../../src/services/aiService'

describe('AIService', () => {
  const mockConfig = {
    provider: 'openai' as const,
    apiKey: 'test-api-key',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    temperature: 0.7
  }

  it('should initialize with config', () => {
    const service = new AIService(mockConfig)
    expect(service).toBeDefined()
  })

  it('createSkippedSummary should include prefix and reason', () => {
    const summary = AIService.createSkippedSummary('内容太短')
    expect(summary).toContain(SKIPPED_SUMMARY_PREFIX)
    expect(summary).toContain('内容太短')
  })

  it('isSkippedSummary should detect skipped marker', () => {
    expect(AIService.isSkippedSummary(`${SKIPPED_SUMMARY_PREFIX} 触发内容过滤`)).toBe(true)
    expect(AIService.isSkippedSummary('普通摘要')).toBe(false)
  })

  it('summarizeChapter should skip very short content', async () => {
    const service = new AIService(mockConfig)
    const summary = await service.summarizeChapter(
      '短章节',
      '太短',
      'non-fiction',
      'zh'
    )

    expect(summary).toContain(SKIPPED_SUMMARY_PREFIX)
  })
})
