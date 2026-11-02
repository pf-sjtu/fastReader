import i18n from '../src/i18n'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import App from '../src/App'
import { useConfigStore } from '../src/stores/configStore'
import { useLibraryStore } from '../src/services/library/libraryStore'
import { applyScan, emptyIndex } from '../src/services/library/libraryIndex'
import { BUILD_VERSION } from '../src/buildInfo'
import { mount, click, flush } from './uiTestUtils'

// App 外壳冒烟：把 App.tsx 拆分前后都要成立的对外行为（配置步 / 结果步切换 / 页脚 / 顶栏）。
// 不 mock useBookProcessing：走真实 hook，保证拆分没有断掉任何接线。

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const text = () => document.body.textContent ?? ''

// WebDAV 自动连接会发网络请求：这里只关心顶栏与视图的接线，不关心连接
vi.mock('@/hooks/useAppShell', async (orig) => ({ ...(await orig<typeof import('@/hooks/useAppShell')>()), useWebDAVAutoConnect: () => {} }))

describe('App 外壳：三阶段切换（书库 · 设置 · 处理），带 WebDAV 的完整应用', () => {
  const tab = (name: string) => document.querySelector<HTMLElement>(`[role="tablist"] [role="tab"][aria-label="${name}"]`)
  const selected = () => Array.from(document.querySelectorAll('[role="tablist"] [role="tab"][aria-selected="true"]')).map((t) => t.getAttribute('aria-label'))

  // 这条测试要改全局 store（WebDAV 启用 + 书架有书）：结束后还原，别污染同文件里依赖默认状态的其它测试
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  it('从结果视图点「书库」回到书库那一段；再点「处理」回结果视图，点「设置」回上传与配置', async () => {
    const prevWebdav = useConfigStore.getState().webdavConfig
    const prevLib = useLibraryStore.getState()
    restore = () => {
      useConfigStore.setState({ webdavConfig: prevWebdav })
      useLibraryStore.setState({ index: prevLib.index, fresh: prevLib.fresh, error: prevLib.error, loadCatalog: prevLib.loadCatalog, loadMirror: prevLib.loadMirror })
    }
    useConfigStore.setState((s) => ({ webdavConfig: { ...s.webdavConfig, enabled: true } }))
    useLibraryStore.setState({
      index: applyScan(emptyIndex(0), [{ path: '/s/甲.epub', size: 1, mtime: 'm' }], { now: 1, summaryNameOf: (n) => `${n}-完整摘要.md`, summaryNames: new Set() }).index,
      fresh: true,
      error: null,
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadMirror: vi.fn().mockResolvedValue(undefined),
    })
    m = mount(<App />)
    await flush()
    expect(['书库', '设置', '处理'].map((n) => !!tab(n))).toEqual([true, true, true])

    click(tab('处理'))
    await flush()
    expect(selected()).toEqual(['处理'])
    expect(document.querySelector('[aria-label="我的书库"]')).toBeNull()

    click(tab('书库')) // 在结果视图里点「书库」：不是回到上传表单，而是书库
    await flush()
    expect(selected()).toEqual(['书库'])
    expect(document.querySelector('[aria-label="我的书库"]')).toBeTruthy()
    expect(text()).not.toContain('暂无处理结果')

    click(tab('处理'))
    await flush()
    expect(text()).toContain('暂无处理结果')
    click(tab('设置'))
    await flush()
    expect(selected()).toEqual(['设置'])
    expect(text()).toContain('文件上传与配置')
    expect(document.querySelector('[aria-label="我的书库"]')).toBeNull()
  })
})

describe('App 外壳', () => {
  it('配置步：品牌标题与副标题、文件选择入口、构建号页脚都在', async () => {
    m = mount(<App />)
    await flush()
    expect(text()).toContain('咀华')
    expect(text()).toContain('把一本书，咀嚼成一页知识')
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
    expect(document.querySelector('footer')?.textContent).toContain(BUILD_VERSION)
    expect(text()).not.toContain('准备就绪') // 同上：没有历史时留白，不复述界面状态
  })

  it('尚无结果时切到「处理」阶段：显示空状态，点「设置」回到配置步', async () => {
    m = mount(<App />)
    await flush()
    const tab = (name: string) => document.querySelector<HTMLElement>(`[role="tablist"] [role="tab"][aria-label="${name}"]`)
    click(tab('处理'))
    await flush()
    expect(text()).toContain('暂无处理结果')
    expect(text()).not.toContain('查看处理结果') // 状态栏不复述「你正在看结果」
    expect(document.querySelector('input[type="file"]')).toBeFalsy()
    expect(tab('处理')?.getAttribute('aria-selected')).toBe('true') // 结果视图里三段仍在，停在「处理」
    click(tab('设置'))
    await flush()
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
    expect(tab('设置')?.getAttribute('aria-selected')).toBe('true')
  })
})
