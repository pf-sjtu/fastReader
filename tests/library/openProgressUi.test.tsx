import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { mount } from '../uiTestUtils'
import { BookCard } from '@/components/library/BookCard'
import { formatEta, openStatusText } from '@/components/library/openProgressLabels'
import { useOpenProgress, type OpenProgress } from '@/stores/openProgress'
import type { LibraryEntry } from '@/services/library/types'

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
})
beforeEach(() => useOpenProgress.getState().clear())

const t = i18n.t.bind(i18n)
const MB = 1024 * 1024
const cur = (over: Partial<OpenProgress> = {}): OpenProgress => ({ path: '/EBook/甲.epub', title: '甲', phase: 'downloading', progress: null, stalled: false, ...over })

describe('formatEta', () => {
  it('秒 / 分秒 / 时分，且至少 1 秒', () => {
    expect(formatEta(t, 0)).toBe('1 秒')
    expect(formatEta(t, 9)).toBe('9 秒')
    expect(formatEta(t, 125)).toBe('2 分 5 秒')
    expect(formatEta(t, 3725)).toBe('1 小时 2 分')
  })
})

describe('openStatusText', () => {
  it('下载中：百分比 · 已下载/总量 · 速度 · 剩余', () => {
    const text = openStatusText(t, cur({ progress: { loaded: 15 * MB, total: 30 * MB, speed: 2 * MB, etaSeconds: 7 } }))
    expect(text).toBe('50% · 15 MB / 30 MB · 2 MB/s · 剩余约 7 秒')
  })

  it('总量未知：只写已下载量与速度，不出现百分比 / NaN / 剩余', () => {
    const text = openStatusText(t, cur({ progress: { loaded: 3 * MB, total: null, speed: MB, etaSeconds: null } }))
    expect(text).toBe('已下载 3 MB · 1 MB/s')
    expect(text).not.toMatch(/NaN|%|剩余/)
  })

  it('久无数据（stalled）：提示连接较慢，不再给出会误导的速度 / 剩余时间', () => {
    const text = openStatusText(t, cur({ stalled: true, progress: { loaded: MB, total: 10 * MB, speed: 5, etaSeconds: 99999 } }))
    expect(text).toContain('连接较慢')
    expect(text).not.toContain('/s')
    expect(text).not.toContain('剩余')
  })

  it('连接 / 解析 / 刚发出请求 三个阶段各有文字', () => {
    expect(openStatusText(t, cur({ phase: 'connecting' }))).toContain('连接')
    expect(openStatusText(t, cur({ phase: 'parsing' }))).toContain('解析')
    expect(openStatusText(t, cur({ phase: 'downloading', progress: null }))).toContain('等待服务器')
  })
})

describe('BookCard 打开中的进度环', () => {
  const entry = { path: '/EBook/甲.epub', size: 1, mtime: '', title: '甲', status: 'unprocessed', stale: false, missingScans: 0, updatedAt: 1 } as LibraryEntry
  const card = () => mount(<BookCard entry={entry} opening disabled onOpen={() => {}} onInfo={() => {}} compact />)

  it('下载中且有总量：显示百分比环', () => {
    useOpenProgress.setState({ current: cur({ progress: { loaded: 30, total: 100, speed: 1, etaSeconds: 1 } }) })
    mounted = card()
    expect(mounted.container.textContent).toContain('30%')
    expect(mounted.container.querySelector('svg circle[stroke-dashoffset]')).toBeTruthy()
  })

  it('连接中 / 解析中：转圈并写出阶段；卡顿时写「较慢」', () => {
    useOpenProgress.setState({ current: cur({ phase: 'connecting' }) })
    mounted = card()
    expect(mounted.container.textContent).toContain('连接中')
    mounted.unmount()
    useOpenProgress.setState({ current: cur({ phase: 'parsing' }) })
    mounted = card()
    expect(mounted.container.textContent).toContain('解析中')
    mounted.unmount()
    useOpenProgress.setState({ current: cur({ stalled: true, progress: { loaded: 1, total: 100, speed: 0, etaSeconds: null } }) })
    mounted = card()
    expect(mounted.container.textContent).toContain('较慢')
  })

  it('进度属于别的书时，这张卡只转圈、不显示别人的百分比', () => {
    useOpenProgress.setState({ current: cur({ path: '/EBook/乙.epub', progress: { loaded: 50, total: 100, speed: 1, etaSeconds: 1 } }) })
    mounted = card()
    expect(mounted.container.textContent).not.toContain('50%')
    expect(mounted.container.querySelector('[role="status"]')).toBeTruthy()
  })
})
