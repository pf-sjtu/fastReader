import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/i18n'
import { mount, pressKey, click, findButton, waitFor, type Mounted } from './uiTestUtils'

// 网络边界：webdavService
const { getDirectoryContents, downloadFileAsFile } = vi.hoisted(() => ({
  getDirectoryContents: vi.fn(),
  downloadFileAsFile: vi.fn(),
}))
vi.mock('../src/services/webdavService', () => ({
  webdavService: {
    isInitialized: () => true,
    initialize: vi.fn(),
    getDirectoryContents,
    downloadFileAsFile,
  },
}))

import { WebDAVFileBrowser } from '../src/components/project/WebDAVFileBrowser'

const files = [
  { filename: '/books/sub', basename: 'sub', type: 'directory', size: 0, lastmod: '2024-01-01' },
  { filename: '/books/a.epub', basename: 'a.epub', type: 'file', size: 1024, lastmod: '2024-01-01' },
]

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

describe('WebDAVFileBrowser 可访问性', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    getDirectoryContents.mockReset()
    getDirectoryContents.mockResolvedValue({ success: true, data: files })
    downloadFileAsFile.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] [role="button"][tabindex="0"]'))

  it('文件行可聚焦，Enter 选中文件、Space 进入目录', async () => {
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows()).toHaveLength(2))
    const [dirRow, fileRow] = rows()
    expect(dirRow.textContent).toContain('sub')
    expect(fileRow.textContent).toContain('a.epub')

    pressKey(fileRow, 'Enter')
    expect(rows()[1].getAttribute('aria-pressed')).toBe('true')

    getDirectoryContents.mockClear()
    pressKey(rows()[0], ' ')
    await waitFor(() => expect(getDirectoryContents).toHaveBeenCalledWith('/books/sub/'))
  })

  it('行内下载按钮下载的是被点击的那一行（不读旧 selectedFile）', async () => {
    downloadFileAsFile.mockResolvedValue({ success: false, error: 'stop' })
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows()).toHaveLength(2))
    const btn = document.querySelector('[aria-label="下载文件 a.epub"]')
    click(btn)
    await waitFor(() => expect(downloadFileAsFile).toHaveBeenCalledWith('/books/a.epub', 'a.epub'))
    expect(findButton('取消')).toBeTruthy()
  })
})
