import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { mount, flush } from '../uiTestUtils'

vi.mock('@/services/webdavService', () => ({
  webdavService: { isInitialized: () => false, onInitialized: () => () => {} },
}))

import { LibraryView } from '@/components/library/LibraryView'
import { useLibraryStore } from '@/services/library/libraryStore'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

const realMatchMedia = window.matchMedia
/** 模拟视口宽度：min-width 查询按宽度判断 */
function setViewport(width: number) {
  window.matchMedia = ((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0)
    return { matches: width >= min, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList
  }) as typeof window.matchMedia
}

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  window.matchMedia = realMatchMedia
})
beforeEach(() => {
  const files = Array.from({ length: 60 }, (_, i) => ({ path: `/s/书${String(i).padStart(2, '0')}.epub`, size: 1, mtime: 'm' }))
  useLibraryStore.setState({
    index: applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: (n) => `${n}-完整摘要.md`, summaryNames: new Set() }).index,
    refreshing: false,
    fresh: true,
    error: null,
    unavailable: false,
    fillProgress: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  })
})

const recCount = () => mounted!.container.querySelectorAll('[aria-label="随机推荐"] button[data-book-card]').length

describe('书库首屏：推荐总是整行（数量 = 列数 × 2）', () => {
  it.each([
    [1280, 16], // lg：8 列
    [800, 12], // sm：6 列
    [400, 8], // 手机：4 列
  ])('视口 %ipx → %i 本', async (width, expected) => {
    setViewport(width)
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    await flush()
    expect(recCount()).toBe(expected)
  })
})
