import i18n from '../src/i18n'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import App from '../src/App'
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
const buttonByText = (re: RegExp) => Array.from(document.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))

describe('App 外壳', () => {
  it('配置步：品牌标题与副标题、文件选择入口、构建号页脚都在', async () => {
    m = mount(<App />)
    await flush()
    expect(text()).toContain('咀华')
    expect(text()).toContain('把一本书，咀嚼成一页知识')
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
    expect(document.querySelector('footer')?.textContent).toContain(BUILD_VERSION)
  })

  it('尚无结果时切到结果步：显示空状态，点「返回配置」回到配置步', async () => {
    m = mount(<App />)
    await flush()
    click(buttonByText(/结果/))
    await flush()
    expect(text()).toContain('暂无处理结果')
    expect(document.querySelector('input[type="file"]')).toBeFalsy()
    click(buttonByText(/^返回配置$/))
    await flush()
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
  })
})
