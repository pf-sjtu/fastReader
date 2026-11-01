import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, findButton, flush, stubDomForRadix } from '../uiTestUtils'

const deleteFile = vi.fn()
const deleteDirectory = vi.fn()
/** `.juhua/books` 下「假装存在」的子目录 */
let davDirs: { basename: string; type: string }[] = []
/** 信封包里的文件：完整路径 → 未压缩的信封文本（假 IO 不做 gzip） */
const artifactFiles = new Map<string, string>()
const io = {
  syncPath: '/fastReader',
  summaryNameOf: (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`,
  listFiles: vi.fn(),
}
vi.mock('@/services/library/libraryIO', () => ({ createLibraryIO: () => io }))
vi.mock('@/services/artifacts/io', () => ({
  createArtifactIO: () => ({
    read: async (p: string) => artifactFiles.get(p) ?? null,
    write: async () => true,
    list: async (dir: string) =>
      Array.from(artifactFiles.keys())
        .filter((p) => p.startsWith(`${dir}/`))
        .map((p) => ({ path: p, basename: p.slice(dir.length + 1), size: 100 })),
    removeDir: async () => true,
  }),
}))
vi.mock('@/services/webdavService', () => ({
  webdavService: {
    isInitialized: () => true,
    getDirectoryContents: async () => ({ success: true, data: davDirs }),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    deleteDirectory: (...a: unknown[]) => deleteDirectory(...a),
  },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ArtifactCleanup } from '@/components/library/ArtifactCleanup'
import { useLibraryStore } from '@/services/library/libraryStore'
import { applyScan, emptyIndex, patchEntry } from '@/services/library/libraryIndex'
import { buildEnvelope, serializeEnvelope, type ArtifactKind as EnvelopeKind } from '@/services/artifacts/envelope'

const BOOKS_ROOT = '/fastReader/.juhua/books'

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
/** 给条目补上标题与「各章总结指纹」（信封比对的依据） */
const withFp = (index: ReturnType<typeof indexOf>, name: string, studyFp: string) =>
  patchEntry(index, `/EBook/${name}`, { title: name.replace(/\.[^/.]+$/, ''), studyFp }, 2)
/** 一份可被 parseEnvelopeText 读懂的信封文本 */
const envText = (kind: EnvelopeKind, bookKey: string, inputsFp: string) => {
  const [title, author] = bookKey.split('|')
  return serializeEnvelope(buildEnvelope({ kind, bookKey, title, author: author || undefined, inputsFp, data: {}, now: 1 }))
}

beforeEach(() => {
  vi.clearAllMocks()
  deleteFile.mockResolvedValue({ success: true })
  deleteDirectory.mockResolvedValue({ success: true })
  davDirs = []
  artifactFiles.clear()
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

  it('信封「已过时」：单独成组、默认不勾选（书还在，只是按旧总结生成）', async () => {
    useLibraryStore.setState({ index: withFp(indexOf('甲.epub'), '甲.epub', '新指纹') })
    artifactFiles.set(`${BOOKS_ROOT}/甲~abc/study.json.gz`, envText('study', '甲|', '旧指纹'))
    davDirs = [{ basename: '甲~abc', type: 'directory' }]
    await open()
    expect(document.body.textContent).toContain('已过时')
    const box = boxes().find((b) => b.getAttribute('aria-label') === '甲~abc/study.json.gz')
    expect(box?.getAttribute('aria-checked')).toBe('false')
  })

  it('整包「书已不在」：默认不勾、挂笔记警示；勾选后走目录删除，不删单个文件', async () => {
    useLibraryStore.setState({ index: indexOf('丙.epub') })
    io.listFiles.mockResolvedValue([])
    artifactFiles.set(`${BOOKS_ROOT}/乙~zzz/study.json.gz`, envText('study', '乙|', 'fp'))
    artifactFiles.set(`${BOOKS_ROOT}/乙~zzz/notes.json.gz`, envText('notes', '乙|', ''))
    davDirs = [{ basename: '乙~zzz', type: 'directory' }]
    await open()
    const box = boxes().find((b) => b.getAttribute('aria-label') === '乙~zzz')!
    expect(box.getAttribute('aria-checked')).toBe('false')
    // 列表里挂警示（图标带 notesWarn 提示文案）
    expect(document.querySelector(`[title="${i18n.t('library.artifacts.notesWarn')}"]`)).toBeTruthy()

    click(box)
    click(findButton(/删除所选 1 个/))
    await flush(1)
    expect(deleteDirectory).not.toHaveBeenCalled() // 确认前不删
    // 确认框里再警示一次
    expect(document.body.textContent).toContain(i18n.t('library.artifacts.notesWarn'))
    await act(async () => {
      findButton('确认删除')!.click()
    })
    await flush()
    expect(deleteDirectory).toHaveBeenCalledWith(`${BOOKS_ROOT}/乙~zzz`)
    expect(deleteFile).not.toHaveBeenCalled()
  })
})
