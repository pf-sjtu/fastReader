import i18n from '../../src/i18n'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { mount } from '../uiTestUtils'
import { ConfigStep } from '@/components/app/ConfigStep'
import type { BookProcessing } from '@/components/app/types'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

const noop = () => {}
const props = { webdavEnabled: true, onOpenBook: vi.fn(), openingPath: null, onLoadFromCloudCache: noop, onStartProcessing: noop, onSetSelection: noop, preview: null }

describe('已精读书打开过程：骨架屏代替「文件上传与配置」卡', () => {
  it('autoOpening 且已有文件：显示「正在打开《书名》…」状态，不出现上传/配置卡与书库', () => {
    const book = { file: new File(['x'], '2049.epub') } as unknown as BookProcessing
    m = mount(<ConfigStep {...props} book={book} autoOpening />)
    const status = m.container.querySelector('[role="status"]')!
    expect(status.textContent).toContain('正在打开《2049.epub》')
    expect(status.querySelector('svg.animate-spin')).toBeTruthy()
    expect(m.container.textContent).not.toContain('文件上传与配置')
    expect(m.container.querySelector('[aria-label="我的书库"]')).toBeNull()
  })
})
