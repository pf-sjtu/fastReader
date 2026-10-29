import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, waitFor, type Mounted } from './uiTestUtils'

// 网络边界：WebDAV / 云缓存；toast
const { existsStatus, uploadFile, uploadChartsJson, toastFn } = vi.hoisted(() => ({
  existsStatus: vi.fn(),
  uploadFile: vi.fn(),
  uploadChartsJson: vi.fn(),
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('../src/services/webdavService', () => ({ webdavService: { existsStatus, uploadFile } }))
vi.mock('../src/services/cloudCacheService', () => ({
  cloudCacheService: { getCacheFileName: (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`, uploadChartsJson },
}))
vi.mock('sonner', () => ({ toast: toastFn }))

import { UploadToWebDAVButton } from '../src/components/UploadToWebDAVButton'
import { ConfigExportImport } from '../src/components/ConfigExportImport'
import { useConfigStore } from '../src/stores/configStore'
import { useAIConfigStore } from '../src/stores/ai-config'
import type { BookSummary } from '../src/hooks/useBookProcessing'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)
const summary = (charts: unknown = null) =>
  ({
    title: '书',
    author: '作者',
    chapters: [{ id: 'c1', title: '一', content: '原文', summary: '摘要' }],
    connections: '关联',
    overallSummary: '总结',
    charts,
  }) as unknown as BookSummary
const file = new File(['x'], 'Book.epub')

let m: Mounted | null = null
beforeEach(() => {
  vi.clearAllMocks()
  const s = useConfigStore.getState()
  s.resetWebDAVConfig()
  s.setWebDAVEnabled(true)
  s.setWebDAVSyncPath('/sync')
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

describe('UploadToWebDAVButton', () => {
  it('WebDAV 未启用时不渲染', () => {
    useConfigStore.getState().setWebDAVEnabled(false)
    m = mount(<UploadToWebDAVButton bookSummary={summary()} file={file} />)
    expect(m.container.innerHTML).toBe('')
  })

  it('挂载时探测云端文件：已存在则提示覆盖，确认后强制上传', async () => {
    existsStatus.mockResolvedValue('exists')
    uploadFile.mockResolvedValue({ success: true })
    m = mount(<UploadToWebDAVButton bookSummary={summary()} file={file} />)
    await waitFor(() => expect(findButton(t('upload.exists'))).toBeTruthy())
    expect(existsStatus).toHaveBeenCalledWith('/sync/Book-完整摘要.md')
    click(findButton(t('upload.exists')))
    await waitFor(() => expect(document.body.textContent).toContain(t('upload.existsQuestionNamed', { fileName: 'Book-完整摘要.md' })))
    expect(document.body.textContent).toContain(t('upload.remotePath', { path: '/sync/Book-完整摘要.md' }))
    click(findButton(t('upload.overwrite')))
    await waitFor(() => expect(toastFn.success).toHaveBeenCalledWith(t('upload.success', { fileName: 'Book-完整摘要.md', note: '' })))
    expect(uploadFile).toHaveBeenCalledWith('/sync/Book-完整摘要.md', expect.stringContaining('摘要'))
    expect(findButton(t('upload.uploaded'))).toBeTruthy()
  })

  it('存在性未知时不冒险覆盖', async () => {
    existsStatus.mockResolvedValueOnce('missing').mockResolvedValueOnce('unknown')
    m = mount(<UploadToWebDAVButton bookSummary={summary()} file={file} />)
    await flush()
    click(findButton(t('upload.upload')))
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(t('upload.existsUnknown')))
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('上传带图表；上传后校验缺失 → 报错；校验未知 → 警告', async () => {
    existsStatus.mockResolvedValue('missing')
    uploadFile.mockResolvedValue({ success: true })
    uploadChartsJson.mockResolvedValue({ success: false, error: 'x' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m = mount(<UploadToWebDAVButton bookSummary={summary({ nodes: [] })} file={file} />)
    await flush()
    click(findButton(t('upload.upload')))
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(t('upload.failedWithError', { error: t('upload.verifyMissing') }))
    )

    existsStatus.mockReset()
    existsStatus.mockResolvedValueOnce('missing').mockResolvedValueOnce('unknown')
    click(findButton(t('upload.upload')))
    await waitFor(() => expect(toastFn.warning).toHaveBeenCalledWith(t('upload.verifyUnknown')))
    await waitFor(() =>
      expect(toastFn.success).toHaveBeenCalledWith(t('upload.success', { fileName: 'Book-完整摘要.md', note: t('upload.chartsFailed') }))
    )

    uploadFile.mockResolvedValueOnce({ success: false })
    existsStatus.mockResolvedValue('missing')
    click(findButton(t('upload.reupload')) ?? findButton(t('upload.uploaded')))
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith(t('upload.failedWithError', { error: t('upload.failed') })))
    warn.mockRestore()
    err.mockRestore()
  })
})

describe('ConfigExportImport', () => {
  it('导出生成下载；空内容不导入；先预览再导入；重置需确认', async () => {
    const createURL = vi.fn(() => 'blob:y')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: vi.fn() }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    m = mount(<ConfigExportImport />)
    click(findButton(t('configIO.exportButton')))
    expect(anchorClick).toHaveBeenCalled()
    expect(toastFn.success).toHaveBeenCalledWith(t('configIO.exportSuccess'))

    const textarea = document.querySelector('textarea')!
    const setValue = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, v)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const { act } = await import('react')
    // 先建一个服务商，否则导出的配置里没有可导入的内容（校验会拒绝空配置）
    act(() => {
      useAIConfigStore.getState().addProvider({
        name: 'demo',
        type: 'openai',
        baseUrl: 'https://api.demo.com/v1',
        models: [{ id: 'm1', enabled: true, source: 'manual' }],
      })
    })

    // 导入分两步：先预览，确认后才写入服务端（导入按钮在预览前是禁用的）
    act(() => setValue(useConfigStore.getState().exportConfig()))
    expect(findButton(t('configIO.importButton'))!.disabled).toBe(true)
    click(findButton(t('configIO.previewButton')))
    expect(document.body.textContent).toContain(t('configIO.previewTitle'))
    expect(findButton(t('configIO.importButton'))!.disabled).toBe(false)

    click(findButton(t('configIO.importButton')))
    expect(toastFn.success).toHaveBeenCalledWith(t('configIO.importSuccess'))
    expect(document.body.textContent).toContain(t('configIO.importSuccessDetail'))

    act(() => setValue(': : not yaml ['))
    click(findButton(t('configIO.previewButton')))
    expect(toastFn.error).toHaveBeenCalled()

    click(findButton(t('configIO.clear')))
    expect(document.querySelector('textarea')!.value).toBe('')

    // 重置改用 AlertDialog 二次确认（不再是 window.confirm）
    click(findButton(t('configIO.resetButton')))
    expect(toastFn.success).not.toHaveBeenCalledWith(t('configIO.resetDone'))
    click(findButton(t('common.confirm')))
    expect(toastFn.success).toHaveBeenCalledWith(t('configIO.resetDone'))
    anchorClick.mockRestore()
    vi.unstubAllGlobals()
  })
})
