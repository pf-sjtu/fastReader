import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { webdavMock, davConfig } = vi.hoisted(() => ({
  webdavMock: {
    getFileContents: vi.fn(),
    existsStatus: vi.fn(),
  },
  davConfig: { syncPath: '/fr', enabled: true },
}))

vi.mock('../src/services/webdavService', () => ({ webdavService: webdavMock }))
vi.mock('../src/stores/configStore', () => ({
  useConfigStore: { getState: () => ({ webdavConfig: davConfig }) },
}))

import {
  buildCloudBook,
  persistLoadedBook,
  refreshChartsJson,
  resolveCloudCharts,
} from '../src/services/pipeline/cloudLoad'
import { readChartsArtifact, saveChartsArtifact } from '../src/services/pipeline/persistence'
import { formatUnifiedMarkdown, generateMetadata } from '../src/services/metadataFormatter'
import { useProcessingHistoryStore } from '../src/stores/processingHistory'
import { RESULT_PREFIX } from '../src/utils/resultStatus'

const charts = {
  version: 1,
  entityGraph: { nodes: [{ id: 'p1', name: '甲' }], edges: [] },
  entityTimeline: { entities: [{ id: 'p1', name: '甲' }], events: [] },
}

const meta = (isPartial?: boolean) =>
  generateMetadata({
    fileName: 'a.epub',
    model: 'gemini-x',
    chapterDetectionMode: 'normal',
    selectedChapters: [1, 2],
    chapterCount: 2,
    originalCharCount: 10,
    processedCharCount: 5,
    isPartial,
  })

const md = (opts: { overall?: string; withCharts?: boolean; partial?: boolean } = {}) =>
  formatUnifiedMarkdown(
    {
      title: '书',
      author: '某人',
      chapters: [
        { id: '1', title: '一', summary: '摘一' },
        { id: '2', title: '二', summary: '摘二' },
      ],
      overallSummary: opts.overall ?? '全书',
      connections: '关联',
      charts: opts.withCharts ? charts : null,
    },
    meta(opts.partial)
  )

describe('cloudLoad', () => {
  beforeEach(() => vi.clearAllMocks())

  it('完整缓存无图表：可自动补图；元数据与标题作者解析', async () => {
    const loaded = (await buildCloudBook({ content: md() }, { fileName: 'a.epub', fallbackTitle: 'a', idPrefix: 'cloud' }))!
    expect(loaded.summary).toMatchObject({ title: '书', author: '某人', overallSummary: '全书', connections: '关联', charts: null })
    expect(loaded.summary.chapters.map((c) => c.id)).toEqual(['cloud-0', 'cloud-1'])
    expect(loaded).toMatchObject({ partial: false, autoCharts: true, notices: [], chapterCount: 2 })
    expect(loaded.metadata?.model).toBe('gemini-x')
  })

  it('isPartial 元数据：提示不完整且不自动补图', async () => {
    const loaded = (await buildCloudBook({ content: md({ partial: true }) }, { fileName: 'a.epub', fallbackTitle: '', idPrefix: 'h' }))!
    expect(loaded).toMatchObject({ partial: true, autoCharts: false, notices: ['partial'] })
  })

  it('图表来源优先级：JSON > MD 内嵌 > 本地副本；JSON 损坏且无其它来源时提示且不自动生成', async () => {
    const fromJson = (await buildCloudBook(
      { content: md(), chartsJson: JSON.stringify(charts), chartsFileFound: true },
      { fileName: 'a.epub', fallbackTitle: '', idPrefix: 'c' }
    ))!
    expect(fromJson.summary.charts).toBeTruthy()
    expect(fromJson.autoCharts).toBe(false)

    const fromMd = (await buildCloudBook(
      { content: md({ withCharts: true }), chartsJson: '{坏', chartsFileFound: true },
      { fileName: 'a.epub', fallbackTitle: '', idPrefix: 'c' }
    ))!
    expect(fromMd.summary.charts).toBeTruthy()
    expect(fromMd.notices).toEqual([])

    const broken = (await buildCloudBook(
      { content: md(), chartsJson: '{坏', chartsFileFound: true },
      { fileName: 'none.epub', fallbackTitle: '', idPrefix: 'c' }
    ))!
    expect(broken.summary.charts).toBeNull()
    expect(broken).toMatchObject({ autoCharts: false, notices: ['chartsParseFailed'] })

    await saveChartsArtifact('local.epub', charts as never)
    expect(await resolveCloudCharts(null, null, 'local.epub')).toBeTruthy()
    expect(await resolveCloudCharts(null, '', null)).toBeNull()
  })

  it('无章节且无全书总结视为解析失败；失败占位章节标为未处理', async () => {
    expect(await buildCloudBook({ content: '随便写点' }, { fileName: null, fallbackTitle: 'x', idPrefix: 'c' })).toBeNull()
    const content = `# 书\n\n## 章节摘要\n\n### 一\n\n${RESULT_PREFIX.chapterFailed}x\n`
    const loaded = (await buildCloudBook({ content }, { fileName: null, fallbackTitle: 'x', idPrefix: 'c' }))!
    expect(loaded.summary.chapters[0].processed).toBe(false)
    expect(loaded.partial).toBe(true)
  })

  it('refreshChartsJson：现场读到则覆盖；读失败沿用快照', async () => {
    webdavMock.getFileContents.mockResolvedValueOnce({ success: true, data: '{"v":2}' })
    expect(await refreshChartsJson('a.epub', { content: 'x', chartsJson: null })).toMatchObject({
      chartsJson: '{"v":2}',
      chartsFileFound: true,
    })
    webdavMock.getFileContents.mockResolvedValueOnce({ success: false, error: '404' })
    expect(await refreshChartsJson('a.epub', { content: 'x', chartsJson: 'old', chartsFileFound: false })).toMatchObject({
      chartsJson: 'old',
      chartsFileFound: false,
    })
  })

  it('persistLoadedBook：保存图表副本并写历史；无文件名时跳过', async () => {
    useProcessingHistoryStore.getState().clearHistory()
    const loaded = (await buildCloudBook(
      { content: md({ withCharts: true }) },
      { fileName: 'p.epub', fallbackTitle: '', idPrefix: 'c' }
    ))!
    await persistLoadedBook(loaded, { fileName: 'p.epub', mode: 'summary', fallbackModel: 'fb' })
    expect(await readChartsArtifact('p.epub')).toBeTruthy()
    expect(useProcessingHistoryStore.getState().records[0]).toMatchObject({ fileName: 'p.epub', model: 'gemini-x', chapterCount: 2 })
    await persistLoadedBook(loaded, { fileName: null, mode: 'summary', fallbackModel: 'fb' })
    expect(useProcessingHistoryStore.getState().records).toHaveLength(1)
  })
})
