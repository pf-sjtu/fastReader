import { describe, it, expect } from 'vitest'
import { cloudCacheService } from '@/services/cloudCacheService'

describe('cloudCache 图表同名 JSON 路径', () => {
  it('MD 与 JSON 同基名', () => {
    const md = cloudCacheService.getCacheFileName('原始码：成为比尔．盖兹.epub')
    const json = cloudCacheService.getChartsCacheFileName('原始码：成为比尔．盖兹.epub')
    expect(md.endsWith('-完整摘要.md')).toBe(true)
    expect(json).toBe(md.replace(/\.md$/i, '.json'))
    expect(json.endsWith('-完整摘要.json')).toBe(true)
  })
})
