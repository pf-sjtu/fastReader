import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CacheService } from '../../src/services/cacheService'

// Mock localStorage for Node.js test environment
const createMockStorage = () => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} }
  }
}

describe('CacheService', () => {
  let cacheService: CacheService
  const mockFilename = 'test-book.epub'

  beforeEach(() => {
    // Mock localStorage for Node.js environment
    Object.defineProperty(global, 'localStorage', {
      value: createMockStorage(),
      writable: true
    })
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
