/**
 * storage：autoSyncService 与 configExportService
 * webdavService / cloudCacheService 的网络方法用 spy 替身，其余为真实逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { autoSyncService } from '../src/services/autoSyncService'
import { webdavService } from '../src/services/webdavService'
import { cloudCacheService } from '../src/services/cloudCacheService'
import { ConfigExportService } from '../src/services/configExportService'
import { useConfigStore } from '../src/stores/configStore'
import { useWebDAVStore } from '../src/stores/webdav'

const book = {
  title: '书',
  author: '作者',
  chapters: [
    { id: '1', title: '一', content: 'abc', summary: 'S1', processed: true },
    { id: '2', title: '二', content: 'de', processed: false }
  ],
  connections: 'C',
  overallSummary: 'O'
}

const ok = { success: true as const, data: true }

beforeEach(() => {
  useWebDAVStore.getState().resetWebDAVConfig()
  useWebDAVStore.getState().updateWebDAVConfig({
    enabled: true, autoSync: true, serverUrl: 'https://d/', username: 'u', password: 'p'
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(webdavService, 'initialize').mockResolvedValue(ok)
})

afterEach(() => vi.restoreAllMocks())

describe('autoSyncService.syncSummary', () => {
  it('上传 MD 到 cloudCache 路径并更新同步时间；有图表时写 JSON', async () => {
    const up = vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    const charts = vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValue({ success: true, path: '/p.json' })
    expect(await autoSyncService.syncSummary({ ...book, charts: { a: 1 } }, 'b.epub')).toBe(true)
    expect(up.mock.calls[0][0]).toBe(cloudCacheService.getCacheFilePath('b.epub'))
    expect(String(up.mock.calls[0][1])).toContain('S1')
    expect(charts).toHaveBeenCalledOnce()
    expect(useConfigStore.getState().webdavConfig.lastSyncTime).not.toBeNull()
  })

  it('图表 JSON 失败不影响 MD 成功', async () => {
    vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValue({ success: false, error: 'x' })
    expect(await autoSyncService.syncSummary({ ...book, charts: {} }, 'b.epub', 'numbered')).toBe(true)
  })

  it('未启用 / 关闭 autoSync（非 force）→ false；force 时忽略 autoSync', async () => {
    const up = vi.spyOn(webdavService, 'uploadFile').mockResolvedValue(ok)
    useWebDAVStore.getState().setWebDAVAutoSync(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub', 'auto', { force: true })).toBe(true)
    useWebDAVStore.getState().setWebDAVEnabled(false)
    expect(await autoSyncService.syncSummary(book, 'b.epub', 'auto', { force: true })).toBe(false)
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('初始化失败 / 上传失败 / 抛异常 → false', async () => {
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false, error: 'e' })
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    vi.spyOn(webdavService, 'uploadFile').mockResolvedValueOnce({ success: false, error: 'e' })
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
    vi.mocked(webdavService.initialize).mockRejectedValueOnce(new Error('boom'))
    expect(await autoSyncService.syncSummary(book, 'b.epub')).toBe(false)
  })
})

describe('autoSyncService.syncChartsJson', () => {
  it('参数校验', async () => {
    expect((await autoSyncService.syncChartsJson('b.epub', null)).error).toBe('无图表数据')
    expect((await autoSyncService.syncChartsJson('  ', {})).error).toBe('文件名为空')
    useWebDAVStore.getState().setWebDAVEnabled(false)
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('WebDAV 未启用')
  })

  it('成功、失败、初始化失败、异常', async () => {
    const charts = vi.spyOn(cloudCacheService, 'uploadChartsJson').mockResolvedValueOnce({ success: true, path: '/p' })
    expect(await autoSyncService.syncChartsJson('b.epub', {})).toEqual({ success: true, path: '/p' })
    charts.mockResolvedValueOnce({ success: false, error: 'x' })
    expect((await autoSyncService.syncChartsJson('b.epub', {})).success).toBe(false)
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false })
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('WebDAV 初始化失败')
    charts.mockRejectedValueOnce(new Error('boom'))
    expect((await autoSyncService.syncChartsJson('b.epub', {})).error).toBe('boom')
  })
})

describe('autoSyncService.syncMindMap', () => {
  const mm = {
    title: 't', author: 'a',
    chapters: [{ id: '1', title: '一', content: '', mindMap: { n: 1 }, processed: true }, { id: '2', title: '二', content: '', processed: false }],
    combinedMindMap: { all: 1 }
  }

  it('未开启自动同步时跳过（返回 true）', async () => {
    useWebDAVStore.getState().setWebDAVAutoSync(false)
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(true)
  })

  it('同步章节与整书导图', async () => {
    const sync = vi.spyOn(webdavService, 'syncFiles').mockResolvedValueOnce(ok)
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(true)
    expect(sync.mock.calls[0][0].map((f) => f.path)).toEqual([
      'b/mindmaps/b_chapter_1_mindmap.json',
      'b/b_combined_mindmap.json'
    ])
    sync.mockResolvedValueOnce({ success: false, error: 'x' })
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
    vi.mocked(webdavService.initialize).mockResolvedValueOnce({ success: false })
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
    sync.mockRejectedValueOnce(new Error('boom'))
    expect(await autoSyncService.syncMindMap(mm, 'b')).toBe(false)
  })
})

describe('ConfigExportService', () => {
  const state = () => useConfigStore.getState()

  it('导出只含数据字段，导入可还原并通过校验', () => {
    const yaml = ConfigExportService.exportConfig(state())
    expect(yaml).not.toContain('addProvider')
    const parsed = ConfigExportService.importConfig(yaml)
    expect(parsed.config.aiConfigManager.providers.length).toBe(state().aiConfigManager.providers.length)
    expect(ConfigExportService.validateConfig(parsed)).toEqual({ isValid: true, errors: [] })
  })

  it('校验报告缺失字段', () => {
    const r = ConfigExportService.validateConfig({
      version: '1.0.0',
      exportTime: 'x',
      config: {
        aiConfigManager: { providers: 'bad', currentModelId: 0 },
        processingOptions: {},
        promptVersionConfig: { v1: {} },
        currentPromptVersion: 'v2'
      }
    } as never)
    expect(r.isValid).toBe(false)
    expect(r.errors).toEqual(expect.arrayContaining([
      'AI服务商配置格式无效', 'currentModelId必须是正整数', '缺少必需的处理选项: processingMode',
      '缺少WebDAV配置', '当前提示词版本 v2 在版本配置中不存在', 'token使用量格式无效'
    ]))
    const empty = ConfigExportService.validateConfig({ version: '1.0.0', exportTime: 'x', config: {} } as never)
    expect(empty.errors).toEqual(expect.arrayContaining(['缺少AI配置管理器', '缺少处理选项配置', '缺少提示词版本配置', '缺少当前提示词版本']))
  })

  it('导入格式错误 / 版本不兼容 / YAML 语法错误', () => {
    expect(() => ConfigExportService.importConfig('a: 1')).toThrow('缺少必需字段')
    expect(() => ConfigExportService.importConfig('version: "2.0.0"\nexportTime: x\nconfig: {a: 1}')).toThrow('不兼容')
    expect(() => ConfigExportService.importConfig('a: [1, 2')).toThrow('配置导入失败')
  })

  it('文件名与备份', () => {
    expect(ConfigExportService.generateFileName()).toMatch(/^ebook-to-mindmap-config-.*\.yaml$/)
    const b = ConfigExportService.createBackup(state())
    expect(b.version).toBe('1.0.0')
    expect(b.config.webdavConfig).toEqual(state().webdavConfig)
    expect(b.config.webdavConfig).not.toBe(state().webdavConfig)
  })
})
