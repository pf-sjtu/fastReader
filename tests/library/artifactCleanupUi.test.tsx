import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, findButton, flush, stubDomForRadix } from '../uiTestUtils'

const deleteFile = vi.fn()
const io = {
  syncPath: '/fastReader',
  summaryNameOf: (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`,
  listFiles: vi.fn(),
}
vi.mock('@/services/library/libraryIO', () => ({ createLibraryIO: () => io }))
vi.mock('@/services/webdavService', () => ({ webdavService: { deleteFile: (...a: unknown[]) => deleteFile(...a) } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ArtifactCleanup } from '@/components/library/ArtifactCleanup'
import { useLibraryStore } from '@/services/library/libraryStore'
import { applyScan, emptyIndex } from '@/services/library/libraryIndex'

stubDomForRadix()

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
const indexOf = (...names: string[]) => applyScan(emptyIndex(0), names.map((n) => ({ path: `/EBook/${n}`, size: 1, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index
const file = (name: string, size = 100) => ({ path: `/fastReader/${name}`, basename: name, size, mtime: '' })

beforeEach(() => {
  vi.clearAllMocks()
  deleteFile.mockResolvedValue({ success: true })
  io.listFiles.mockResolvedValue([file('甲_chapter_1_summary.md'), file('乙-完整摘要.json'), file('丙-完整摘要.md', 5000), file('丁-完整摘要.md')])
  useLibraryStore.setState({ index: indexOf('丁.epub'), catalog: {}, fresh: true, error: null, refresh: vi.fn().mockResolvedValue(undefined) })
})

const open = async () => {
  mounted = mount(<ArtifactCleanup />)
  click(findButton('清理过时产物'))
  await flush()
}
const boxes = () => Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))

describe('ArtifactCleanup', () => {
  it('打开即重新扫描；分三组展示；确定没用的（旧格式 / 悬空）默认勾选，「书已不在」默认不勾', async () => {
    await open()
    expect(useLibraryStore.getState().refresh).toHaveBeenCalled()
    const text = document.body.textContent!
    for (const s of ['旧版格式', '悬空附件', '书已不在']) expect(text).toContain(s)
    const byName = (n: string) => boxes().find((b) => b.getAttribute('aria-label') === n)!
    expect(byName('甲_chapter_1_summary.md').getAttribute('aria-checked')).toBe('true')
    expect(byName('乙-完整摘要.json').getAttribute('aria-checked')).toBe('true')
    expect(byName('丙-完整摘要.md').getAttribute('aria-checked')).toBe('false')
    expect(boxes().some((b) => b.getAttribute('aria-label') === '丁-完整摘要.md')).toBe(false) // 书还在：不进清单
    expect(findButton(/删除所选 2 个/)).toBeTruthy()
  })

  it('二次确认后只删勾选项；勾上「书已不在」才会删它', async () => {
    await open()
    click(boxes().find((b) => b.getAttribute('aria-label') === '丙-完整摘要.md')!)
    click(findButton(/删除所选 3 个/))
    await flush(1)
    expect(deleteFile).not.toHaveBeenCalled() // 确认前不删
    await act(async () => {
      findButton('确认删除')!.click()
    })
    await flush()
    const paths = deleteFile.mock.calls.map((c) => c[0]).sort()
    expect(paths).toEqual(['/fastReader/丙-完整摘要.md', '/fastReader/乙-完整摘要.json', '/fastReader/甲_chapter_1_summary.md'].sort())
  })

  it('没勾任何项：删除按钮禁用', async () => {
    await open()
    for (const b of boxes().filter((x) => x.getAttribute('aria-checked') === 'true')) click(b)
    expect(findButton(/删除所选 0 个/)!.disabled).toBe(true)
  })

  it('扫描没成功（fresh=false）：不给清单、不删除任何东西', async () => {
    useLibraryStore.setState({ fresh: false, error: '超时' })
    await open()
    expect(document.body.textContent).toContain('扫描没有成功')
    expect(boxes()).toHaveLength(0)
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('一本书都没扫到（多半目录配错）：拒绝给清单', async () => {
    useLibraryStore.setState({ index: emptyIndex(0) })
    await open()
    expect(document.body.textContent).toContain('一本书都没扫到')
    expect(boxes()).toHaveLength(0)
  })

  it('没有过时产物：明确告知', async () => {
    io.listFiles.mockResolvedValue([file('丁-完整摘要.md')])
    await open()
    expect(document.body.textContent).toContain('没有发现过时产物')
  })
})
