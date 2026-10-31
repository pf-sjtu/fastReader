import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, flush } from '../uiTestUtils'
import { useStudyStore, studyDeps } from '@/study/studyStore'
import { emptyStudyData, studyKeyOf, type StudyBackend } from '@/study/persistence'
import type { Quiz, StudyKit } from '@/study/schema'
import { AskPanel } from '@/components/study/AskPanel'
import { DepthSwitch } from '@/components/study/DepthSwitch'
import { QuizPanel } from '@/components/study/QuizPanel'
import { StudyKitPanel } from '@/components/study/StudyKitPanel'
import type { BookSummary } from '@/types/book'

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

const book = {
  title: '书',
  author: '',
  connections: '',
  overallSummary: '全书总结',
  chapters: [1, 2, 3].map((n) => ({ id: `c${n}`, title: `第${n}章`, content: '', processed: true, summary: n === 2 ? '约翰逊提出杠杆收购方案。' : `第${n}章总结` })),
} as unknown as BookSummary

const kit: StudyKit = {
  version: 1,
  chapters: [{ chapterId: 'c2', chapterTitle: '第2章', oneLiner: '提出方案', points: ['要点甲', '要点乙', '要点丙'], terms: [{ term: '杠杆收购', definition: '用债务收购' }] }],
}
const quiz: Quiz = {
  version: 1,
  questions: [
    { id: 'q1', type: 'choice', question: '谁提出方案？', options: ['约翰逊', 'KKR'], answerIndex: 0, explanation: '见第2章。', chapterId: 'c2', chapterTitle: '第2章' },
    { id: 'q2', type: 'short', question: '为何失败？', answer: '出价不如对手', explanation: '', chapterId: null, chapterTitle: '' },
  ],
}

const ai = { generateStudyKit: vi.fn(), generateQuiz: vi.fn(), askBook: vi.fn() }
const noopBackend: StudyBackend = { load: async () => null, save: async () => {}, remove: async () => {} }

beforeEach(async () => {
  vi.clearAllMocks()
  studyDeps.backend = noopBackend
  studyDeps.createAI = () => ai as never
  useStudyStore.setState({ bookKey: null, data: emptyStudyData(), chat: [], depth: 'full', running: { kit: false, quiz: false, ask: false }, kitProgress: null, errors: { kit: null, quiz: null } })
  await useStudyStore.getState().bind(book)
})

const btn = (text: string | RegExp) =>
  Array.from(mounted!.container.querySelectorAll('button')).find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')))
const seed = (patch: Partial<ReturnType<typeof emptyStudyData>>) => useStudyStore.setState({ data: { ...emptyStudyData(), ...patch } })

describe('DepthSwitch', () => {
  it('没有速读包：要点/一句话置灰且给出提示；全文可用', () => {
    mounted = mount(<DepthSwitch chapters={book.chapters} />)
    expect(btn('全文')!.disabled).toBe(false)
    expect(btn('要点')!.disabled).toBe(true)
    expect(btn('一句话')!.title).toContain('速读')
  })

  it('有速读包：可切换并持久化；只覆盖部分章节时提示其余保持全文', () => {
    seed({ kit })
    mounted = mount(<DepthSwitch chapters={book.chapters} />)
    click(btn('一句话'))
    expect(useStudyStore.getState().depth).toBe('oneliner')
    mounted.rerender(<DepthSwitch chapters={book.chapters} />)
    expect(btn('一句话')!.getAttribute('aria-pressed')).toBe('true')
    expect(mounted.container.textContent).toContain('1/3 章有速读卡')
    click(btn('全文'))
    mounted.rerender(<DepthSwitch chapters={book.chapters} />)
    expect(mounted.container.textContent).not.toContain('1/3 章有速读卡')
  })
})

describe('StudyKitPanel', () => {
  it('空状态给出说明；生成前显示用量预估；点击生成后渲染卡片', async () => {
    ai.generateStudyKit.mockResolvedValue(kit)
    mounted = mount(<StudyKitPanel bookSummary={book} onJumpChapter={() => {}} />)
    expect(mounted.container.textContent).toContain('速读包把每一章压缩')
    expect(mounted.container.querySelector('[data-testid="study-estimate"]')?.textContent).toContain('tokens')
    click(btn('生成速读包'))
    await flush()
    const text = mounted.container.textContent ?? ''
    for (const t of ['提出方案', '要点甲', '要点丙', '杠杆收购', '用债务收购']) expect(text).toContain(t)
    expect(btn('重新生成')).toBeTruthy()
  })

  it('点章节标题跳转；没映射到章节的卡片不可点', () => {
    seed({ kit: { version: 1, chapters: [...kit.chapters, { chapterId: null, chapterTitle: '孤儿章', oneLiner: 'x', points: ['p'], terms: [] }] } })
    const onJump = vi.fn()
    mounted = mount(<StudyKitPanel bookSummary={book} onJumpChapter={onJump} />)
    click(btn('第2章'))
    expect(onJump).toHaveBeenCalledWith('c2')
    expect(btn('孤儿章')!.disabled).toBe(true)
  })

  it('生成失败显示错误；无可用章节总结时按钮置灰', async () => {
    ai.generateStudyKit.mockRejectedValue(new Error('HTTP 500'))
    mounted = mount(<StudyKitPanel bookSummary={book} onJumpChapter={() => {}} />)
    click(btn('生成速读包'))
    await flush()
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 500')
    mounted.rerender(<StudyKitPanel bookSummary={{ ...book, chapters: [] } as BookSummary} onJumpChapter={() => {}} />)
    expect(btn(/生成速读包|重新生成/)!.disabled).toBe(true)
  })
})

describe('QuizPanel', () => {
  const panel = (onJump = vi.fn()) => <QuizPanel bookSummary={book} currentChapterId="c2" onJumpChapter={onJump} />

  it('选择题：答错标红并显示正确项、解析与出处链接；同一题不能再改', () => {
    seed({ quiz })
    const onJump = vi.fn()
    mounted = mount(panel(onJump))
    click(btn(/KKR/)) // 错误选项
    const card = mounted.container.querySelector('li[data-answered]')!
    expect(card.getAttribute('data-answered')).toBe('wrong')
    expect(card.textContent).toContain('见第2章。')
    click(btn('出处：第2章'))
    expect(onJump).toHaveBeenCalledWith('c2')
    expect(Array.from(card.querySelectorAll('button')).filter((b) => b.disabled).length).toBe(2) // 选项都锁定
    expect(mounted.container.textContent).toContain('答对 0 / 已答 1（共 2 题）')
  })

  it('简答题：先点开参考答案再自评；自评结果计入成绩', () => {
    seed({ quiz })
    mounted = mount(panel())
    expect(mounted.container.textContent).not.toContain('出价不如对手')
    click(btn('显示参考答案'))
    expect(mounted.container.textContent).toContain('出价不如对手')
    click(btn('答对了'))
    expect(useStudyStore.getState().data.answers.q2).toEqual({ picked: null, correct: true })
    expect(mounted.container.textContent).toContain('答对 1 / 已答 1')
  })

  it('错题本：只看错题筛选；重做清空作答', () => {
    seed({ quiz, answers: { q1: { picked: 1, correct: false }, q2: { picked: null, correct: true } } })
    mounted = mount(panel())
    expect(mounted.container.querySelectorAll('li[data-answered]')).toHaveLength(2)
    click(btn(/只看错题 1/))
    expect(mounted.container.querySelectorAll('li[data-answered]')).toHaveLength(1)
    expect(mounted.container.textContent).toContain('谁提出方案')
    click(btn('重做'))
    expect(useStudyStore.getState().data.answers).toEqual({})
    expect(mounted.container.querySelectorAll('li[data-answered]')).toHaveLength(0)
  })

  it('出题：按选择的范围与题数调用；"当前章"只传当前章', async () => {
    ai.generateQuiz.mockResolvedValue(quiz)
    mounted = mount(panel())
    const select = (label: string, value: string) => {
      const el = mounted!.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    select('范围', 'chapter')
    select('题数', '5')
    click(btn('生成自测题'))
    await flush()
    const [, chapters, count] = ai.generateQuiz.mock.calls[0]
    expect(count).toBe(5)
    expect(chapters.map((c: { id: string }) => c.id)).toEqual(['c2'])
    expect(mounted.container.textContent).toContain('谁提出方案')
  })
})

describe('AskPanel', () => {
  const type = (value: string) => {
    const ta = mounted!.container.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, value)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return ta
  }
  const key = (ta: HTMLElement, k: string, shiftKey = false) =>
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }))
    })

  it('Enter 发送；回答带章节引用，点引用跳转；输入框清空', async () => {
    ai.askBook.mockResolvedValue('约翰逊提出了方案【第2章】。')
    const onJump = vi.fn()
    mounted = mount(<AskPanel bookSummary={book} onJumpChapter={onJump} />)
    expect(mounted.container.textContent).toContain('试着问')
    const ta = type('杠杆收购是什么')
    key(ta, 'Enter')
    await flush()
    expect(ai.askBook).toHaveBeenCalledTimes(1)
    expect(mounted.container.textContent).toContain('约翰逊提出了方案')
    expect(ta.value).toBe('')
    click(btn('第2章'))
    expect(onJump).toHaveBeenCalledWith('c2')
  })

  it('Shift+Enter 换行不发送；空白内容不发送；发送按钮在空输入时禁用', () => {
    mounted = mount(<AskPanel bookSummary={book} onJumpChapter={() => {}} />)
    const ta = type('问题')
    key(ta, 'Enter', true)
    expect(ai.askBook).not.toHaveBeenCalled()
    type('   ')
    key(ta, 'Enter')
    expect(ai.askBook).not.toHaveBeenCalled()
    expect((mounted.container.querySelector('button[aria-label="发送"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('失败显示错误；清空对话', async () => {
    ai.askBook.mockRejectedValue(new Error('网络错误'))
    mounted = mount(<AskPanel bookSummary={book} onJumpChapter={() => {}} />)
    key(type('问'), 'Enter')
    await flush()
    expect(mounted.container.textContent).toContain('失败：网络错误')
    click(btn('清空'))
    expect(useStudyStore.getState().chat).toEqual([])
  })
})

describe('绑定指纹', () => {
  it('同一本书指纹稳定（面板重挂载不会丢数据）', () => {
    expect(studyKeyOf(book)).toBe(studyKeyOf(book))
  })
})
