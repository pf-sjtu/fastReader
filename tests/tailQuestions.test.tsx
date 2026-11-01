import { describe, it, expect, afterEach } from 'vitest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { extractTailQuestions, normalizeTailQuestions, questionsOfLine } from '@/lib/tailQuestions'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'
import { mount } from './uiTestUtils'

describe('questionsOfLine', () => {
  it('整行问句才算；剥掉列表符号 / 序号 / Q1：', () => {
    expect(questionsOfLine('为什么？')).toEqual(['为什么？'])
    expect(questionsOfLine('1. 甲？')).toEqual(['甲？'])
    expect(questionsOfLine('- 乙？')).toEqual(['乙？'])
    expect(questionsOfLine('Q2：丙？')).toEqual(['丙？'])
    expect(questionsOfLine('这是陈述句。')).toBeNull()
    expect(questionsOfLine('问了个问题？然后离开了。')).toBeNull()
  })
  it('同行连写多个问句拆开；过长的论述不按问号切碎', () => {
    expect(questionsOfLine('甲是什么？ 乙为何？')).toEqual(['甲是什么？', '乙为何？'])
    const long = '这是一段很长很长的分析性文字用来说明为什么不能被当作问题列表来处理'.repeat(2)
    expect(questionsOfLine(`${long}？甲？`)).toBeNull()
  })
})

describe('normalizeTailQuestions', () => {
  it('三种写法统一成每题一段，幂等', () => {
    const a = normalizeTailQuestions('结尾。\n\n甲？\n\n乙？\n\n丙？')
    const b = normalizeTailQuestions('结尾。\n甲？\n乙？\n丙？')
    const c = normalizeTailQuestions('结尾。\n\n甲？ 乙？ 丙？')
    expect(a).toBe('结尾。\n\n甲？\n\n乙？\n\n丙？')
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(normalizeTailQuestions(a)).toBe(a)
  })
  it('只有一个问句 / 文末不是问句：原样', () => {
    expect(normalizeTailQuestions('正文。\n\n甲？')).toBe('正文。\n\n甲？')
    expect(normalizeTailQuestions('甲？\n乙？\n\n最后是陈述。')).toBe('甲？\n乙？\n\n最后是陈述。')
    expect(extractTailQuestions('')).toBeNull()
  })
  it('全文都是问题：head 为空，不多出空行', () => {
    expect(normalizeTailQuestions('甲？\n乙？')).toBe('甲？\n\n乙？')
  })
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const render = (md: string) => {
  m = mount(<ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkTailQuestions]}>{md}</ReactMarkdown>)
  return document.querySelector('.chapter-questions')
}

describe('remarkTailQuestions：渲染时把文末问句与正文区隔', () => {
  it('每题一段 → 包进 chapter-questions，正文不在其中', () => {
    const box = render('正文一段。\n\n甲？\n\n乙？\n\n丙？')!
    expect([...box.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['甲？', '乙？', '丙？'])
    expect(box.textContent).not.toContain('正文')
    expect(document.body.textContent).toContain('正文一段。')
  })
  it('兼容旧缓存：每题一行不空行 / 同行连写 / 编号列表', () => {
    for (const md of ['正文。\n\n甲？\n乙？', '正文。\n\n甲？ 乙？', '正文。\n\n1. 甲？\n2. 乙？']) {
      m?.unmount()
      const box = render(md)!
      expect(box, md).toBeTruthy()
      expect([...box.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['甲？', '乙？'])
    }
  })
  it('只有一个问句 / 文末不是问句：不包装', () => {
    expect(render('正文。\n\n甲？')).toBeNull()
    m?.unmount()
    expect(render('甲？\n\n乙？\n\n结论。')).toBeNull()
  })
  it('带加粗的问句整段保留（保留格式）', () => {
    const box = render('正文。\n\n**甲**是什么？\n\n乙？')!
    expect(box.querySelector('strong')?.textContent).toBe('甲')
  })
})
