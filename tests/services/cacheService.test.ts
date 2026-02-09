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

// Mock requestIdleCallback for Node.js environment
declare global {
  var requestIdleCallback: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number) | undefined
  var cancelIdleCallback: ((handle: number) => void) | undefined
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

  describe('LRU eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should evict least recently used items when exceeding MAX_CACHE_SIZE', () => {
      // MAX_CACHE_SIZE is 100, test with smaller number for performance
      const maxSize = 5
      const service = new CacheService()

      // Set cache size via reflection for testing
      // @ts-expect-error - accessing private field for testing
      service.MAX_CACHE_SIZE = maxSize

      // Add items up to max size with time advancement
      for (let i = 0; i < maxSize; i++) {
        vi.advanceTimersByTime(10)
        service.set(`book-${i}.epub`, 'summary', `content-${i}`)
      }

      expect(service.getStats().totalEntries).toBe(maxSize)

      // Access first item to make it recently used
      vi.advanceTimersByTime(10)
      service.getString('book-0.epub', 'summary')

      // Add one more item, should evict the least recently used (book-1, not book-0)
      vi.advanceTimersByTime(10)
      service.set('new-book.epub', 'summary', 'new content')

      expect(service.getStats().totalEntries).toBe(maxSize)
      expect(service.getString('book-0.epub', 'summary')).toBe('content-0') // Should still exist
      expect(service.getString('book-1.epub', 'summary')).toBeNull() // Should be evicted
    })

    it('should update lastAccessed on get operations', () => {
      const service = new CacheService()

      vi.advanceTimersByTime(10)
      service.set('book-a.epub', 'summary', 'content-a')
      vi.advanceTimersByTime(10)
      service.set('book-b.epub', 'summary', 'content-b')

      // Access book-a to update its lastAccessed
      vi.advanceTimersByTime(100)
      service.getString('book-a.epub', 'summary')

      // @ts-expect-error - accessing private field for testing
      service.MAX_CACHE_SIZE = 2

      // Add a new item, book-b should be evicted (older access time)
      vi.advanceTimersByTime(10)
      service.set('book-c.epub', 'summary', 'content-c')

      expect(service.getString('book-a.epub', 'summary')).toBe('content-a')
      expect(service.getString('book-b.epub', 'summary')).toBeNull()
    })
  })

  describe('debounced persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should schedule save with debounce', () => {
      const service = new CacheService()
      const setItemSpy = vi.spyOn(localStorage, 'setItem')

      service.set('book.epub', 'summary', 'content-1')

      // Immediately after set, localStorage should not be called yet (debounced)
      expect(setItemSpy).not.toHaveBeenCalled()

      // Advance timers past debounce delay (500ms)
      vi.advanceTimersByTime(600)

      // Now localStorage should have been called
      expect(setItemSpy).toHaveBeenCalled()
    })

    it('should reset debounce timer on multiple rapid sets', () => {
      const service = new CacheService()
      const setItemSpy = vi.spyOn(localStorage, 'setItem')

      service.set('book.epub', 'summary', 'content-1')
      vi.advanceTimersByTime(300)
      service.set('book.epub', 'connections', 'content-2')
      vi.advanceTimersByTime(300)
      service.set('book.epub', 'overall_summary', 'content-3')

      // Should not have saved yet
      expect(setItemSpy).not.toHaveBeenCalled()

      // Advance past the last debounce
      vi.advanceTimersByTime(600)

      // Should have saved now
      expect(setItemSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('idle callback persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      delete global.requestIdleCallback
    })

    it('should use requestIdleCallback when available', () => {
      const mockIdleCallback = vi.fn((callback: () => void) => {
        // Immediately invoke callback for testing
        callback()
        return 123 // fake handle
      })
      global.requestIdleCallback = mockIdleCallback as unknown as typeof global.requestIdleCallback

      const service = new CacheService()
      const setItemSpy = vi.spyOn(localStorage, 'setItem')

      service.set('book.epub', 'summary', 'content')

      // Manually trigger the debounced save
      vi.advanceTimersByTime(600)

      expect(mockIdleCallback).toHaveBeenCalled()
      expect(setItemSpy).toHaveBeenCalled()
    })

    it('should fallback to setTimeout when requestIdleCallback is not available', () => {
      // Ensure requestIdleCallback is not available
      delete global.requestIdleCallback

      const service = new CacheService()
      const setItemSpy = vi.spyOn(localStorage, 'setItem')

      service.set('book.epub', 'summary', 'content')

      // Advance timers
      vi.advanceTimersByTime(600)

      expect(setItemSpy).toHaveBeenCalled()
    })
  })

  describe('cache loading with expiry', () => {
    it('should filter expired cache entries on load', () => {
      const now = Date.now()
      const expiredTime = now - 8 * 24 * 60 * 60 * 1000 // 8 days ago (expired)
      const validTime = now - 1 * 24 * 60 * 60 * 1000 // 1 day ago (valid)

      const storedData = {
        'book_expired_summary': {
          data: 'expired content',
          timestamp: expiredTime,
          lastAccessed: expiredTime
        },
        'book_valid_summary': {
          data: 'valid content',
          timestamp: validTime,
          lastAccessed: validTime
        }
      }

      localStorage.setItem('ebook-processor-cache', JSON.stringify(storedData))

      const service = new CacheService()

      expect(service.getString('expired.epub', 'summary')).toBeNull()
      expect(service.getString('valid.epub', 'summary')).toBe('valid content')
    })

    it('should handle corrupted localStorage data gracefully', () => {
      localStorage.setItem('ebook-processor-cache', 'invalid-json{}}')

      // Should not throw
      expect(() => new CacheService()).not.toThrow()
    })
  })

  describe('clearBookCache with processingMode', () => {
    it('should clear only summary-related caches for summary mode', () => {
      const service = new CacheService()

      // Set up various caches
      service.set('book.epub', 'summary', 'summary content')
      service.set('book.epub', 'connections', 'connections content')
      service.set('book.epub', 'overall_summary', 'overall content')
      service.set('book.epub', 'mindmap', { nodeData: { id: '1', topic: 'Test' } })

      const deletedCount = service.clearBookCache('book.epub', 'summary')

      expect(deletedCount).toBeGreaterThan(0)
      expect(service.getString('book.epub', 'connections')).toBeNull()
      expect(service.getString('book.epub', 'overall_summary')).toBeNull()
    })

    it('should clear only mindmap-related caches for mindmap mode', () => {
      const service = new CacheService()

      service.set('book.epub', 'summary', 'summary content')
      service.set('book.epub', 'mindmap', { nodeData: { id: '1', topic: 'Test' } })
      service.set('book.epub', 'merged_mindmap', { nodeData: { id: '2', topic: 'Merged' } })

      const deletedCount = service.clearBookCache('book.epub', 'mindmap')

      expect(deletedCount).toBeGreaterThan(0)
      expect(service.getString('book.epub', 'summary')).toBe('summary content') // Should remain
      expect(service.getMindMap('book.epub', 'merged_mindmap')).toBeNull()
    })

    it('should clear all caches when no processingMode specified', () => {
      const service = new CacheService()

      // Set caches that clearBookCache will actually delete
      service.set('book.epub', 'summary', 'summary content')
      service.set('book.epub', 'connections', 'connections content')
      service.set('book.epub', 'overall_summary', 'overall content')
      service.set('book.epub', 'combined_mindmap', { nodeData: { id: '1', topic: 'Test' } })
      service.set('book.epub', 'selected_chapters', ['ch1', 'ch2'])

      const deletedCount = service.clearBookCache('book.epub')

      // Should delete the items we created
      expect(deletedCount).toBeGreaterThanOrEqual(4)
      expect(service.getStats().totalEntries).toBe(0)
    })
  })
})
