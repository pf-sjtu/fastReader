import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mount, click, findButton, pressKey, stubDomForRadix } from '../uiTestUtils'
import { buildEntityLinking } from '@/charts/linking/entityLinking'
import { EntityCard } from '@/components/workspace/EntityCard'
import { EventCard } from '@/components/workspace/EventCard'
import { EntityStrip } from '@/components/workspace/EntityStrip'
import { FloatingCard } from '@/components/workspace/FloatingCard'
import { placeCard } from '@/components/workspace/anchor'
import { canHover, chapterOfMark, isSelectingText, pickMark } from '@/components/workspace/useArtifactNavigation'
import type { BookCharts } from '@/charts/types'

stubDomForRadix()

// 断言依赖中文文案；jsdom 默认 en-US，显式切换并在结束后还原
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

const chapters = [
  { id: 'c1', title: '第1章 序幕', text: '罗斯·约翰逊担任纳贝斯克的首席执行官。' },
  { id: 'c2', title: '第2章 私有化', text: '罗斯·约翰逊提出私有化方案。' },
  { id: 'c3', title: '第3章 登场', text: 'KKR开始关注纳贝斯克。' },
  { id: 'c4', title: '第4章 摊牌', text: '罗斯·约翰逊与KKR正面对立。' },
  { id: 'c6', title: '第6章 结局', text: '薛利先生见证罗斯·约翰逊败给KKR。' },
]
const charts: BookCharts = {
  version: 1,
  entityGraph: {
    nodes: [
      { id: 'ross', name: '罗斯·约翰逊', type: '人物', importance: 9, description: '发起私有化的纳贝斯克CEO' },
      { id: 'nab', name: '纳贝斯克', type: '组织', importance: 8 },
      { id: 'kkr', name: 'KKR', type: '组织', importance: 8 },
      { id: 'shelly', name: '薛利先生', type: '人物', importance: 3 },
    ],
    edges: [
      { source: 'ross', target: 'nab', relation: '领导' }, // c1：已读
      { source: 'ross', target: 'kkr', relation: '对立' }, // c4：当前章
      { source: 'ross', target: 'shelly', relation: '顾问' }, // c6：未读
    ],
  },
  entityTimeline: {
    entities: [{ id: 'ross', name: '罗斯·约翰逊' }],
    events: [
      { id: 'e1', label: '提出私有化', timeLabel: '1988-10', order: 1, entityIds: ['ross'], chapterHint: '第2章' },
      { id: 'e2', label: '正面交锋', timeLabel: '1988-11', order: 2, entityIds: ['ross', 'kkr'], chapterHint: '第4章' },
      { id: 'e3', label: '败给KKR', timeLabel: '1989-01', order: 3, entityIds: ['ross'], chapterHint: '第6章' },
    ],
  },
}
const linking = buildEntityLinking(charts, chapters)

const noop = () => {}
const cardProps = {
  linking,
  entityId: 'ross',
  currentChapterId: 'c4',
  onOpenEntity: noop,
  onOpenEvent: noop,
  onJumpOccurrence: noop,
  onJumpTimeline: noop,
  onJumpGraph: noop,
}

describe('EntityCard 防剧透：折叠内容不进 DOM', () => {
  it('折叠态只渲染严格早于当前章的信息', () => {
    mounted = mount(<EntityCard {...cardProps} />)
    const text = mounted.container.textContent ?? ''
    expect(text).toContain('领导') // c1 的关系
    expect(text).toContain('提出私有化') // c2 的事件
    // 当前章(c4)与之后(c6)：文字根本不在 DOM 里，而不是被 CSS 藏起来
    for (const leaked of ['对立', '顾问', '正面交锋', '败给KKR']) {
      expect(text, `不应泄漏「${leaked}」`).not.toContain(leaked)
    }
  })

  it('点击展开后才出现被折叠的内容，再点收起又消失', () => {
    mounted = mount(<EntityCard {...cardProps} />)
    const toggle = findButton(/展开/)!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    click(toggle)
    const text = mounted.container.textContent ?? ''
    expect(text).toContain('对立')
    expect(text).toContain('顾问')
    expect(text).toContain('败给KKR')
    click(findButton(/收起/))
    expect(mounted.container.textContent).not.toContain('顾问')
  })

  it('换成另一个实体后展开状态复位', () => {
    mounted = mount(<EntityCard {...cardProps} />)
    click(findButton(/展开/))
    expect(mounted.container.textContent).toContain('顾问')
    mounted.rerender(<EntityCard {...cardProps} entityId="kkr" />)
    mounted.rerender(<EntityCard {...cardProps} entityId="ross" />)
    expect(mounted.container.textContent).not.toContain('顾问')
  })

  it('不知道当前章时整张卡全部折叠', () => {
    mounted = mount(<EntityCard {...cardProps} currentChapterId={undefined} />)
    const text = mounted.container.textContent ?? ''
    expect(text).not.toContain('领导')
    expect(text).not.toContain('提出私有化')
  })
})

describe('EventCard 防剧透', () => {
  it('当前章及之后的事件折叠：标签不进 DOM，点开才显示', () => {
    mounted = mount(
      <EventCard linking={linking} eventId="e3" currentChapterId="c4" onOpenEntity={noop} onJumpChapter={noop} />
    )
    expect(mounted.container.textContent).not.toContain('败给KKR')
    click(findButton(/展开/))
    expect(mounted.container.textContent).toContain('败给KKR')
  })

  it('更早章节的事件直接可见，且"跳到对应章节"带上正确章节', () => {
    const jump = vi.fn()
    mounted = mount(
      <EventCard linking={linking} eventId="e1" currentChapterId="c4" onOpenEntity={noop} onJumpChapter={jump} />
    )
    expect(mounted.container.textContent).toContain('提出私有化')
    click(findButton(/跳到对应章节/))
    expect(jump).toHaveBeenCalledWith('c2')
  })
})

describe('EntityStrip', () => {
  it('列出本章出场实体，点击只回调（不跳转）并带上章节 id', () => {
    const open = vi.fn()
    mounted = mount(<EntityStrip linking={linking} chapterId="c4" onOpenEntity={open} />)
    const names = Array.from(mounted.container.querySelectorAll('button')).map((b) => b.textContent)
    expect(names.some((n) => n?.includes('罗斯·约翰逊'))).toBe(true)
    expect(names.some((n) => n?.includes('薛利先生'))).toBe(false) // 只在 c6 出现
    click(mounted.container.querySelector('button'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][2]).toBe('c4')
  })
})

describe('placeCard', () => {
  const vp = { width: 1000, height: 700 }
  const size = { width: 340, height: 200 }

  it('默认贴在锚点下方并水平居中', () => {
    const p = placeCard({ x: 400, y: 100, width: 100, height: 20 }, size, vp)
    expect(p.placement).toBe('below')
    expect(p.top).toBe(128)
    expect(p.left).toBe(450 - 170)
  })

  it('下方放不下就翻到上方', () => {
    const p = placeCard({ x: 400, y: 600, width: 100, height: 20 }, size, vp)
    expect(p.placement).toBe('above')
    expect(p.top).toBe(600 - 8 - 200)
  })

  it('左右不超出视口', () => {
    expect(placeCard({ x: 0, y: 100, width: 10, height: 10 }, size, vp).left).toBe(8)
    expect(placeCard({ x: 990, y: 100, width: 10, height: 10 }, size, vp).left).toBe(1000 - 340 - 8)
  })

  it('比视口还高的卡片：上下都放不下时不越出顶部', () => {
    const p = placeCard({ x: 400, y: 350, width: 100, height: 20 }, { width: 340, height: 900 }, vp)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
})

describe('FloatingCard', () => {
  it('Esc 关闭；点卡片外关闭，点卡片内不关闭', () => {
    const onClose = vi.fn()
    mounted = mount(
      <FloatingCard anchor={{ x: 10, y: 10, width: 20, height: 20 }} onClose={onClose} label="测试卡片">
        <button>内部按钮</button>
      </FloatingCard>
    )
    const card = document.querySelector('[aria-label="测试卡片"]')!
    expect(card).toBeTruthy()
    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    pressKey(document.body, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('正文标注定位辅助', () => {
  it('pickMark：按序号取，越界退到最后一个，空列表为 null', () => {
    const marks = [document.createElement('span'), document.createElement('span'), document.createElement('span')]
    expect(pickMark(marks, 1)).toBe(marks[0])
    expect(pickMark(marks, 3)).toBe(marks[2])
    expect(pickMark(marks, 9)).toBe(marks[2])
    expect(pickMark(marks, 0)).toBe(marks[0])
    expect(pickMark([], 1)).toBeNull()
  })

  it('chapterOfMark：取最近的 chapter-summary-* 祖先', () => {
    const card = document.createElement('div')
    card.id = 'chapter-summary-c4'
    const inner = document.createElement('p')
    const mark = document.createElement('span')
    inner.appendChild(mark)
    card.appendChild(inner)
    expect(chapterOfMark(mark)).toBe('c4')
    expect(chapterOfMark(document.createElement('span'))).toBeUndefined()
  })
})

describe('防误触守卫', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('canHover：无 matchMedia（如 jsdom）按可悬停处理；(hover: none) 的触屏不可悬停', () => {
    expect(canHover()).toBe(true)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)' }))
    expect(canHover()).toBe(false)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(canHover()).toBe(true)
  })

  it('isSelectingText：有框选文字时为真，空选区/纯空白为假', () => {
    const sel = (text: string) => vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text } as Selection)
    sel('保罗·艾伦')
    expect(isSelectingText()).toBe(true)
    vi.restoreAllMocks()
    sel('   ')
    expect(isSelectingText()).toBe(false)
    vi.restoreAllMocks()
    sel('')
    expect(isSelectingText()).toBe(false)
    vi.restoreAllMocks()
  })
})
