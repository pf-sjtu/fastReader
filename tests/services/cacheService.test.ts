import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CacheService, type CacheKeyType } from '../../src/services/cacheService'

describe('CacheService', () => {
  let cacheService: CacheService
  const mockFilename = 'test-book.epub'

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    cacheService = new CacheService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('set and get', () => {
    it('should store and retrieve string value', () => {
      cacheService.set(mockFilename, 'summary', 'test content')
      const result = cacheService.getString(mockFilename, 'summary')
      expect(result).toBe('test content')
    })

    it('should store and retrieve mindmap value', () => {
      const mindmapData = {
        nodeData: { id: 'root', topic: 'Test' },
        linkData: {}
      }
      cacheService.set(mockFilename, 'mindmap', mindmapData)
      const result = cacheService.getMindMap(mockFilename, 'mindmap')
      expect(result).toEqual(mindmapData)
    })

    it('should return null for non-existent key', () => {
      const result = cacheService.getString(mockFilename, 'summary')
      expect(result).toBeNull()
    })
  })

  describe('delete', () => {
    it('should delete cached value', () => {
      cacheService.set(mockFilename, 'summary', 'test content')
      cacheService.delete(mockFilename, 'summary')
      const result = cacheService.getString(mockFilename, 'summary')
      expect(result).toBeNull()
    })
  })

  describe('clearBookCache', () => {
    it('should clear all cache for a book', () => {
      cacheService.set(mockFilename, 'summary', 'summary content')
      cacheService.set(mockFilename, 'connections', 'connections content')
      
      cacheService.clearBookCache(mockFilename)
      
      expect(cacheService.getString(mockFilename, 'summary')).toBeNull()
      expect(cacheService.getString(mockFilename, 'connections')).toBeNull()
    })
  })

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cacheService.set(mockFilename, 'summary', 'test')
      cacheService.set('another.epub', 'summary', 'test2')
      
      const stats = cacheService.getStats()
      expect(stats.totalEntries).toBe(2)
      expect(stats.keys).toHaveLength(2)
    })
  })
})
